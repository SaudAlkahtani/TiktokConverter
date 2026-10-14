export function subscribeToJobs(queue, response) {
  const send = (jobs) => {
    if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(jobs)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n');
  }, 15000);
  heartbeat.unref();
  const cleanup = () => {
    clearInterval(heartbeat);
    queue.off('update', send);
    response.off('close', cleanup);
    response.off('error', cleanup);
  };
  response.once('close', cleanup);
  response.once('error', cleanup);
  queue.on('update', send);
  send(queue.snapshot());
}
