"""verify.py -- check every book reference in the doctrine files against the books themselves.

    python tools/doctrine-refs/verify.py                      # report only
    python tools/doctrine-refs/verify.py --write              # also record the result in each reference
    python tools/doctrine-refs/verify.py --text fm650=FM6-50.txt --write   # an online source checked from its text

Each figure in MS/Data/GunDoctrine.json and AdminDoctrine.json carries `refs`: the book (a source id), the printed page
and the words quoted. For a source with a local `file` (a PDF under Material/), the book is turned into text with
pdftotext (reading order, one page per form feed) and the quote is looked for, letters and digits only, case and
punctuation ignored, across line breaks. Found on a page whose header or footer carries the cited page number: ok.
Found elsewhere: the page is reported. Not found: missing (exit code 1). A web page kept as text (`file` ending .txt, its
URL and the date fetched on the first line) is read the same way, without page numbers. A source with only a `url` is checked when its
text is given with --text, else it is left "unchecked" and says so. Password-protected PDFs are opened with the digits
of any "PW - <digits>.txt" file in the books folder. Nothing is sent anywhere; the PDFs are read where they are.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFAULT_FILES = ['MS/Data/GunDoctrine.json', 'MS/Data/AdminDoctrine.json']
BOOKS = os.path.join(ROOT, 'Material', 'Literature', '1. Books')
CACHE = os.path.join(tempfile.gettempdir(), 'pams8-doctrine-refs')


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def passwords():
    out = []
    if os.path.isdir(BOOKS):
        for f in os.listdir(BOOKS):
            m = re.match(r'PW\s*-\s*(\d+)\.txt$', f)
            if m:
                out.append(m.group(1))
    return out


def pdf_pages(path):
    """The PDF as a list of page texts (cached by path, size and mtime)."""
    st = os.stat(path)
    key = hashlib.sha1(f'{path}|{st.st_size}|{st.st_mtime}'.encode()).hexdigest()[:16]
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, key + '.txt')
    if not os.path.exists(out):
        ok = False
        for pw in [None] + passwords():
            cmd = ['pdftotext'] + (['-upw', pw] if pw else []) + [path, out]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0 and os.path.exists(out):
                ok = True
                break
        if not ok:
            raise RuntimeError(f'pdftotext could not read {path}')
    return open(out, encoding='utf-8', errors='replace').read().split('\f')


def text_pages(path):
    return open(path, encoding='utf-8', errors='replace').read().split('\f')


def page_has_number(page, num):
    """The cited printed page appears as a word in the first or last lines of the page (its header or footer)."""
    if not num:
        return False
    # "5. 503" printed with a space after the point reads as 5.503
    lines = [re.sub(r'(\d)\.\s+(\d)', r'\1.\2', l.strip()) for l in page.splitlines() if l.strip()]
    # in reading order a running head can land mid-page: the number alone on a line counts anywhere
    if any(l == num for l in lines):
        return True
    for l in lines[:5] + lines[-5:]:
        if num in re.split(r'\s+', l):
            return True
    return False


def find(pages, quote, num, web=False):
    q = norm(quote)
    hits = [i for i, p in enumerate(pages) if q and q in norm(p)]
    if not hits:
        return 'missing', None
    if web and not num:
        # a web page kept as text has no printed page: found is enough
        return 'ok', hits[0] + 1
    for i in hits:
        if page_has_number(pages[i], num):
            return 'ok', i + 1
    return 'page?', hits[0] + 1


def layout_page(pdf, n):
    """One page in layout mode (the running head that reading order can drop)."""
    for pw in [None] + passwords():
        cmd = ['pdftotext', '-layout', '-f', str(n), '-l', str(n)] + (['-upw', pw] if pw else []) + [pdf, '-']
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode == 0:
            return r.stdout
    return ''


def walk(node, path=()):
    """Every refs list in a doctrine document, with its path."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ('refs', 'methodRefs') and isinstance(v, list):
                yield path + (k,), v
            else:
                yield from walk(v, path + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, path + (i,))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='*', default=DEFAULT_FILES)
    ap.add_argument('--write', action='store_true', help='record the result in each reference')
    ap.add_argument('--text', action='append', default=[], help='id=path: the text of an online source (pages split by form feeds)')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    texts = dict(t.split('=', 1) for t in a.text)
    today = datetime.date.today().isoformat()
    bad = 0
    for rel in a.files:
        path = os.path.join(ROOT, rel)
        doc = json.load(open(path, encoding='utf-8'))
        sources = {s['id']: s for s in doc.get('sources', [])}
        cache = {}
        print(f'\n{rel}')
        for where, refs in walk(doc):
            for r in refs:
                s = sources.get(r.get('book'))
                label = '.'.join(str(x) for x in where[:-1])
                if not s:
                    print(f'  ? {label}: unknown source {r.get("book")}')
                    bad += 1
                    continue
                pages = None
                how = None
                try:
                    if r['book'] in texts:
                        pages = cache.setdefault(r['book'], text_pages(texts[r['book']]))
                        how = 'text of the online copy'
                    elif s.get('file', '').lower().endswith('.pdf') and os.path.exists(os.path.join(ROOT, s['file'])):
                        pages = cache.setdefault(r['book'], pdf_pages(os.path.join(ROOT, s['file'])))
                        how = 'pdftotext of ' + s['file']
                    elif s.get('file', '').lower().endswith('.txt') and os.path.exists(os.path.join(ROOT, s['file'])):
                        # a web page kept as text (its URL and the date fetched on the first line)
                        pages = cache.setdefault(r['book'], text_pages(os.path.join(ROOT, s['file'])))
                        how = 'saved text of ' + s['file']
                except RuntimeError as e:
                    print(f'  ! {label}: {e}')
                if pages is None:
                    status, pdf = 'unchecked', None
                    note = 'online source: not checked here' if s.get('url') else 'no local copy'
                else:
                    status, pdf = find(pages, r.get('quote') or '', str(r.get('page') or ''), web=how.startswith('saved text'))
                    note = how
                    if status == 'page?' and how.startswith('pdftotext') and page_has_number(layout_page(os.path.join(ROOT, s['file']), pdf), str(r.get('page') or '')):
                        status, note = 'ok', how + ' (page number read in layout mode)'
                mark = {'ok': 'OK  ', 'page?': 'PAGE', 'missing': 'MISS', 'unchecked': '--  '}[status]
                print(f'  {mark} {label}: {s.get("short", r["book"])} p {r.get("page") or "-"} "{r.get("quote")}"' + (f'  (PDF p {pdf})' if pdf else '') + ('' if status in ('ok',) else f'  [{note}]'))
                if status == 'missing':
                    bad += 1
                if a.write:
                    prev = r.get('checked') or {}
                    # a source not checkable in this run keeps an earlier finding (an online copy checked before)
                    if status == 'unchecked' and prev.get('status') in ('ok', 'page?'):
                        continue
                    r['checked'] = {'status': status, 'pdfPage': pdf, 'on': today, 'how': note}
        if a.write:
            json.dump(doc, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
            open(path, 'a', encoding='utf-8').write('\n')
    print(f'\n{"all references found" if not bad else f"{bad} reference(s) not found"}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
