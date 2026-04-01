module.exports = {
  apps: [
    {
      name: 'cleon-ui-pi',
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3015,
        HOST: '0.0.0.0'
      },
      env_development: {
        NODE_ENV: 'development'
      }
    }
  ]
};
