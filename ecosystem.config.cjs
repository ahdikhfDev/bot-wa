module.exports = {
  apps: [{
    name: 'bot-wa',
    script: './src/index.js',
    env: {
      NODE_ENV: 'production',
    },
    max_restarts: 5,
    restart_delay: 5000,
    max_memory_restart: '500M',
    kill_timeout: 5000,
    exp_backoff_restart_delay: 100,
  }]
};
