// Development-only companion to android-reachability-probe.js. ADB must forward
// localhost:9223 to the current Android WebView debugging socket first.
const fs = require('node:fs');
const expression = fs.readFileSync(0, 'utf8');

(async () => {
  const pages = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
  const page = pages.find(item => item.type === 'page' && item.url === 'about:blank');
  if (!page) throw new Error('Local reader page unavailable');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => {
    console.error('Android reader evaluation timed out');
    process.exitCode = 1;
    socket.close();
  }, 55000);

  socket.addEventListener('open', () => socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  })));
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.id !== 1) return;
    clearTimeout(timer);
    if (response.error || response.result?.exceptionDetails) {
      console.error(response.error?.message || response.result.exceptionDetails.exception?.description || 'Reader evaluation failed');
      process.exitCode = 1;
      socket.close();
      return;
    }
    const value = response.result?.result?.value;
    if (value?.summary && (value.summary.passed !== value.summary.caseCount || value.summary.failures?.length)) process.exitCode = 1;
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(value ?? response, null, 2) + '\n');
    console.log(JSON.stringify(value?.summary ?? value ?? response, null, 2));
    socket.close();
  });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    process.exitCode = 1;
  });
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
