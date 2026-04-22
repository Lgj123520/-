import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
/**
 * 与地址栏主机名一致，避免 Next 开发模式把静态资源指到 localhost、页面却用 127.0.0.1 打开时出现白屏。
 * 若你习惯用 http://localhost:PORT ，启动前设置：NEXT_DEV_HOSTNAME=localhost
 * （不用系统变量 HOSTNAME，以免在部分环境被设成机器名。）
 */
const hostname = process.env.NEXT_DEV_HOSTNAME || '127.0.0.1';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    if (dev) {
      console.log(
        '> 请用上述地址打开页面；勿混用 localhost 与 127.0.0.1，否则可能出现标题有、内容白屏。',
      );
    }
  });
});
