/** Vite inline-worker imports (`?worker&inline`): a Worker constructor with the worker's code embedded. */
declare module '*?worker&inline' {
  const WorkerConstructor: new (options?: { name?: string }) => Worker;
  export default WorkerConstructor;
}
