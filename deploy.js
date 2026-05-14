import { Client } from 'ssh2';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const conn = new Client();

const config = {
    host: '192.168.1.198',
    port: 22,
    username: 'root',
    password: 'ahdikhf2006'
};

const remoteDir = '/root/thirty-bot';
const localFile = 'bot.tar.gz';

console.log(`🚀 Connecting to STB at ${config.host}...`);

conn.on('ready', () => {
    console.log('✅ SSH Connection established!');

    console.log(`🚀 Streaming and Extracting directly to ${remoteDir}...`);
    conn.exec(`mkdir -p ${remoteDir} && tar -xzf - -C ${remoteDir}`, (err, stream) => {
        if (err) throw err;

        const readStream = fs.createReadStream(localFile);
        readStream.pipe(stream);

        readStream.on('end', () => {
            console.log('✅ Streaming finished.');
            stream.end();
        });

        stream.on('close', () => {
            console.log('✅ Extraction finished! Finalizing setup...');
            
            const finalCommands = [
                `cd ${remoteDir} && npm install`,
                `cd ${remoteDir} && pm2 restart thirty-bot || pm2 start src/index.js --name thirty-bot`,
                'pm2 save',
                'echo "✅ FIXED & READY! Thirty AI is online with New Model (Rate Limit Bypass)."'
            ];

            let cur = 0;
            const runCmd = () => {
                if (cur >= finalCommands.length) {
                    console.log('\n🌟 THIRTY IS LIVE AND READY!');
                    conn.end();
                    return;
                }
                console.log(`\nExecuting: ${finalCommands[cur]}`);
                conn.exec(finalCommands[cur], (err, stream) => {
                    stream.on('close', () => { cur++; runCmd(); })
                          .on('data', d => process.stdout.write(d))
                          .stderr.on('data', d => process.stderr.write(d));
                });
            };
            runCmd();
        });
    });
}).on('error', (err) => {
    console.error('❌ SSH Error:', err.message);
}).connect(config);
