module.exports = {
    apps: [{
        name: 'bot-wa',
        script: 'src/index.js',
        watch: false,
        max_memory_restart: '500M',
        env: {
            NODE_ENV: 'production',
        },
        error_file: 'logs/pm2-error.log',
        out_file: 'logs/pm2-out.log',
        time: true,
    }]
};
