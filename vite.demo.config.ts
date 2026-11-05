// Temporary: a no-HMR copy of the dev server for a demo while another session edits files.
import base from './vite.config';
export default (env: any) => { const c: any = (base as any)(env); c.server = { ...c.server, hmr: false, port: 6549 }; return c; };
