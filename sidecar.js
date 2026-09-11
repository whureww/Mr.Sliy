/**
 * Tauri sidecar 薄壳：以桌面模式启动现有 Express server。
 * 端口由 Tauri 注入 MRSLIY_PORT，转换为现有代码读取的 PORT 环境变量。
 */
process.env.MRSLIY_MODE = 'desktop';
if (process.env.MRSLIY_PORT && !process.env.PORT) {
  process.env.PORT = process.env.MRSLIY_PORT;
}
// 桌面模式固定绑定 IPv4 回环，与 Rust 端 127.0.0.1 桥接一致
process.env.HOST = '127.0.0.1';

// 父进程 watchdog：Tauri 主进程退出/崩溃/被卸载时，sidecar 自动退出避免孤儿进程
if (process.env.MRSLIY_PARENT_PID) {
  const ppid = Number(process.env.MRSLIY_PARENT_PID);
  setInterval(() => {
    try {
      process.kill(ppid, 0);
    } catch {
      process.exit(0);
    }
  }, 3000).unref();
}

require('./src/index.js');
