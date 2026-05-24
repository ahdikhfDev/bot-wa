import { Client } from 'ssh2';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const conn = new Client();

const host = process.env.DEPLOY_HOST;
const port = parseInt(process.env.DEPLOY_PORT || '22', 10);
const username = process.env.DEPLOY_USER;
const password = process.env.DEPLOY_PASSWORD;
const privateKeyPath = process.env.DEPLOY_PRIVATE_KEY_PATH;

if (!host || !username) {
    throw new Error('DEPLOY_HOST dan DEPLOY_USER wajib diisi di .env');
}

if (!password && !privateKeyPath) {
    throw new Error('Isi DEPLOY_PASSWORD atau DEPLOY_PRIVATE_KEY_PATH di .env');
}

if (!fs.existsSync(process.env.DEPLOY_ARCHIVE || 'bot.tar.gz')) {
    throw new Error('File archive deploy tidak ditemukan');
}

const config = {
    host,
    port,
    username,
    ...(privateKeyPath ? { privateKey: fs.readFileSync(privateKeyPath) } : { password })
};

const remoteDir = process.env.DEPLOY_REMOTE_DIR || '/root/thirty-bot';
const localFile = process.env.DEPLOY_ARCHIVE || 'bot.tar.gz';

console.log(`Connecting to target at ${config.host}:${config.port} ...`);

conn.on('ready', () => {
    console.log('SSH connection established.');
    console.log(`Streaming and extracting to ${remoteDir} ...`);

    conn.exec(`mkdir -p ${remoteDir} && tar -xzf - -C ${remoteDir}`, (err, stream) => {
        if (err) throw err;

        const readStream = fs.createReadStream(localFile);
        readStream.pipe(stream);

        readStream.on('end', () => {
            console.log('Streaming finished.');
            stream.end();
        });

        stream.on('close', () => {
            console.log('Extraction finished. Finalizing setup...');

            const finalCommands = [
                `cd ${remoteDir} && npm install`,
                `cd ${remoteDir} && pm2 restart thirty-bot || pm2 start src/index.js --name thirty-bot`,
                'pm2 save',
                'echo "Deploy completed."'
            ];

            let cur = 0;
            const runCmd = () => {
                if (cur >= finalCommands.length) {
                    console.log('\nDeploy flow finished.');
                    conn.end();
                    return;
                }
                console.log(`\nExecuting: ${finalCommands[cur]}`);
                conn.exec(finalCommands[cur], (execErr, execStream) => {
                    if (execErr) throw execErr;
                    execStream.on('close', () => {
                        cur++;
                        runCmd();
                    }).on('data', d => process.stdout.write(d))
                        .stderr.on('data', d => process.stderr.write(d));
                });
            };
            runCmd();
        });
    });
}).on('error', (err) => {
    console.error('SSH error:', err.message);
}).connect(config);
