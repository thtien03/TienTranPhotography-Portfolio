module.exports = {
  apps: [
    {
      name: 'portfolio-backend',
      script: './backend/server.js',
      // Dùng cú pháp này để bật flag --experimental-sqlite của Node.js 22.x
      node_args: '--experimental-sqlite',
      // Vị trí chạy luôn từ gốc
      cwd: __dirname,
      // Khi file đổi sẽ không tự động restart ở bản production (tránh giật web)
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      // Tự động khởi động lại khi crash 
      autorestart: true,
      // File log để debug sau này
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }
  ]
};
