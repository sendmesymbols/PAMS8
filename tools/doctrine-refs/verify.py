"""verify.py -- check every book reference in the doctrine files against the books themselves.

    python tools/doctrine-refs/verify.py                      # report only
    python tools/doctrine-refs/verify.py --write              # also record the result in each reference
    python tools/doctrine-refs/verify.py --text fm650=FM6-50.txt --write   # an online source checked from its text

Each figure in MS/Data/GunDoctrine.json and AdminDoctrine.json carries `refs`: the book (a source id), the printed page
and the words quoted. For a source with a local `file` (a PDF under Material/), the book is turned into text with
pdftotext (reading order, one page per form feed) and the quote is looked for, letters and digits only, case and
punctuation ignored, across line breaks. Found on a page whose header or footer carries the cited page number: ok.
Found elsewhere: the page is reported. Not found: missing (exit code 1). A table row that reading order splits is looked
for again in layout mode, then raw mode (pdftotext -layout / -raw). A PDF page that prints no number is cited as
"pdf <n>", its place in the file. A web page kept as text (`file` ending .txt, its URL and the date fetched
on the first line) is read the same way, without page numbers, and so is any other local text file (a YAML class table,
a data summary). A source with only a `url` is checked when its
text is given with --text, else it is left "unchecked" and says so. Password-protected PDFs are opened with the digits
of any "PW - <digits>.txt" file in the books folder. Nothing is sent anywhere; the PDFs are read where they are.

`sources` may be a list of {id, ...} or an object keyed by id (OcokaDoctrine.json). --write records the result in each
reference; a file written by hand in a compact layout (not json.dumps indent 2) keeps its layout: only the reference
objects whose result changed are rewritten, in place.
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


def pdf_pages(path, mode=''):
    """The PDF as a list of page texts (cached by path, size and mtime), in reading order, or in 'layout' or 'raw' mode."""
    st = os.stat(path)
    key = hashlib.sha1(f'{path}|{st.st_size}|{st.st_mtime}'.encode()).hexdigest()[:16]
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, key + (f'-{mode}' if mode else '') + '.txt')
    if not os.path.exists(out):
        ok = False
        for pw in [None] + passwords():
            cmd = ['pdftotext'] + ([f'-{mode}'] if mode else []) + (['-upw', pw] if pw else []) + [path, out]
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
    m = re.match(r'pdf\s*(\d+)$', num, re.I)
    if m:
        # a page that prints no number is cited by its place in the PDF ("pdf 3")
        n = int(m.group(1))
        return ('ok', n) if n - 1 in hits else ('page?', hits[0] + 1)
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


def source_map(doc):
    """The sources by id, whether the file lists them or keys them by id."""
    src = doc.get('sources', [])
    if isinstance(src, dict):
        return {k: dict(v, id=k) for k, v in src.items() if isinstance(v, dict)}
    return {s['id']: s for s in src if isinstance(s, dict) and 'id' in s}


def spans(text):
    """Character spans of every JSON object in `text`, by path (keys and list indices), from a small parser that
    follows the decoder; used to rewrite reference objects in place without reflowing a hand-laid file."""
    dec = json.JSONDecoder()
    out = {}

    def ws(i):
        while i < len(text) and text[i] in ' \t\r\n':
            i += 1
        return i

    def val(i, path):
        i = ws(i)
        c = text[i]
        if c == '{':
            start, i = i, ws(i + 1)
            if text[i] == '}':
                out[path] = (start, i + 1)
                return i + 1
            while True:
                key, i = dec.raw_decode(text, ws(i))
                i = ws(i)
                assert text[i] == ':'
                i = ws(val(i + 1, path + (key,)))
                if text[i] == ',':
                    i += 1
                    continue
                assert text[i] == '}'
                out[path] = (start, i + 1)
                return i + 1
        if c == '[':
            i, k = ws(i + 1), 0
            if text[i] == ']':
                return i + 1
            while True:
                i = ws(val(i, path + (k,)))
                k += 1
                if text[i] == ',':
                    i += 1
                    continue
                assert text[i] == ']'
                return i + 1
        _, end = dec.raw_decode(text, i)
        return end

    val(0, ())
    return out


def inline(v):
    """One-line JSON in the hand-laid style: { "a": 1, "b": [1, 2] }."""
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{json.dumps(k, ensure_ascii=False)}: {inline(x)}' for k, x in v.items()) + ' }' if v else '{}'
    if isinstance(v, list):
        return '[' + ', '.join(inline(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)


def write_in_place(path, text, doc, changed):
    """Rewrite only the reference objects at `changed` (paths), keeping the rest of the file as it was."""
    sp = spans(text)
    edits = []
    for p in changed:
        a, b = sp[p]
        node = doc
        for k in p:
            node = node[k]
        old = text[a:b]
        if '\n' in old:
            col = a - (text.rfind('\n', 0, a) + 1)
            new = json.dumps(node, indent=2, ensure_ascii=False).replace('\n', '\n' + ' ' * col)
        else:
            new = inline(node)
        edits.append((a, b, new))
    for a, b, new in sorted(edits, reverse=True):
        text = text[:a] + new + text[b:]
    json.loads(text)  # still valid
    open(path, 'w', encoding='utf-8', newline='\n').write(text)


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
        text = open(path, encoding='utf-8').read()
        doc = json.loads(text)
        # a file laid out by json.dumps(indent=2) is written back the same way; any other layout is kept as it is
        canonical = text == json.dumps(doc, indent=2, ensure_ascii=False) + '\n'
        sources = source_map(doc)
        cache = {}
        changed = []
        print(f'\n{rel}')
        for where, refs in walk(doc):
            for ri, r in enumerate(refs):
                s = sources.get(r.get('book'))
                label = '.'.join(str(x) for x in where[:-1])
                if not s:
                    print(f'  ? {label}: unknown source {r.get("book")}')
                    bad += 1
                    continue
                pages = None
                how = None
                local = os.path.join(ROOT, s['file']) if s.get('file') else None
                try:
                    if r['book'] in texts:
                        pages = cache.setdefault(r['book'], text_pages(texts[r['book']]))
                        how = 'text of the online copy'
                    elif local and local.lower().endswith('.pdf') and os.path.exists(local):
                        pages = cache.setdefault(r['book'], pdf_pages(local))
                        how = 'pdftotext of ' + s['file']
                    elif local and os.path.isfile(local):
                        # a web page kept as text (its URL and the date fetched on the first line), or a local text file
                        pages = cache.setdefault(r['book'], text_pages(local))
                        how = 'saved text of ' + s['file']
                except RuntimeError as e:
                    print(f'  ! {label}: {e}')
                if pages is None:
                    status, pdf = 'unchecked', None
                    note = 'online source: not checked here' if s.get('url') else 'no local copy'
                else:
                    status, pdf = find(pages, r.get('quote') or '', str(r.get('page') or ''), web=how.startswith('saved text'))
                    note = how
                    for mode in ('layout', 'raw'):
                        if status != 'missing' or not how.startswith('pdftotext'):
                            break
                        # a table row that reading order splits: look again in layout, then raw mode
                        status, pdf = find(cache.setdefault(r['book'] + '|' + mode, pdf_pages(local, mode)), r.get('quote') or '', str(r.get('page') or ''))
                        if status != 'missing':
                            note = how + f' ({mode} mode)'
                    if status == 'page?' and how.startswith('pdftotext') and page_has_number(layout_page(local, pdf), str(r.get('page') or '')):
                        status, note = 'ok', note + ' (page number read in layout mode)'
                mark = {'ok': 'OK  ', 'page?': 'PAGE', 'missing': 'MISS', 'unchecked': '--  '}[status]
                print(f'  {mark} {label}: {s.get("short", r["book"])} p {r.get("page") or "-"} "{r.get("quote")}"' + (f'  (PDF p {pdf})' if pdf else '') + ('' if status in ('ok',) else f'  [{note}]'))
                if status == 'missing':
                    bad += 1
                if a.write:
                    prev = r.get('checked') or {}
                    # a source not checkable in this run keeps an earlier finding (an online copy checked before)
                    if status == 'unchecked' and prev.get('status') in ('ok', 'page?'):
                        continue
                    new = {'status': status, 'pdfPage': pdf, 'on': today, 'how': note}
                    if new != prev:
                        r['checked'] = new
                        changed.append(where + (ri,))
        if a.write and changed:
            if canonical:
                json.dump(doc, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
                open(path, 'a', encoding='utf-8').write('\n')
            else:
                write_in_place(path, text, doc, changed)
    print(f'\n{"all references found" if not bad else f"{bad} reference(s) not found"}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
