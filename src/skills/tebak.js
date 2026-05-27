// Indonesian words for the game
const WORDS = [
    'nusantara', 'merdeka', 'persatuan', 'kebangsaan', 'pancasila',
    'jendela', 'komputer', 'sejarah', 'budaya', 'bahasa',
    'pelangi', 'cokelat', 'strawberi', 'keluarga', 'pendidikan',
    'teknologi', 'kesehatan', 'lingkungan', 'masyarakat', 'perjuangan',
    'kemerdekaan', 'kedaulatan', 'keadilan', 'kesejahteraan', 'keragaman',
    'pesawat', 'kendaraan', 'pekerjaan', 'persahabatan', 'percintaan',
    'gembira', 'semangat', 'tangguh', 'berani', 'bijaksana',
    'bermain', 'belajar', 'bekerja', 'bergaul', 'berbagi',
    'matahari', 'bintang', 'planet', 'galaksi', 'alam semesta',
];

// Active games: remoteJid -> game state
const games = new Map();

function createGame(word) {
    const target = word.toLowerCase();
    const display = target.split('').map(() => '_');
    return {
        word: target,
        display,
        guessedLetters: new Set(),
        wrongGuesses: 0,
        maxWrong: 7,
        status: 'playing',
    };
}

function checkGuess(game, letter) {
    letter = letter.toLowerCase();
    if (letter.length !== 1 || !/[a-z]/.test(letter)) {
        return { valid: false, message: 'Masukkan 1 huruf a-z ya!' };
    }
    if (game.guessedLetters.has(letter)) {
        return { valid: false, message: `Huruf "${letter}" udah ditebak sebelumnya!` };
    }

    game.guessedLetters.add(letter);

    if (game.word.includes(letter)) {
        // Reveal letters
        for (let i = 0; i < game.word.length; i++) {
            if (game.word[i] === letter) {
                game.display[i] = letter;
            }
        }
        // Check win
        if (!game.display.includes('_')) {
            game.status = 'won';
        }
        return { valid: true, correct: true, message: `✅ Huruf "${letter}" ADA!` };
    } else {
        game.wrongGuesses++;
        if (game.wrongGuesses >= game.maxWrong) {
            game.status = 'lost';
        }
        return { valid: true, correct: false, message: `❌ Huruf "${letter}" TIDAK ADA! (${game.wrongGuesses}/${game.maxWrong})` };
    }
}

function getHangmanArt(wrong) {
    const stages = [
        '```\n  +---+\n      |\n      |\n      |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========\n```',
        '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========\n```',
    ];
    return stages[wrong] || stages[stages.length - 1];
}

function formatGame(game) {
    const hangman = getHangmanArt(game.wrongGuesses);
    const wordDisplay = game.display.map(c => c === '_' ? '▢' : c).join(' ');
    const guessed = Array.from(game.guessedLetters).join(', ');

    let header = '🎮 *TEBAK KATA* 🎮\n\n';
    if (game.status === 'won') {
        header = '🎉 *SELAMAT! KAMU MENANG!* 🎉\n\n';
    } else if (game.status === 'lost') {
        header = `💀 *GAME OVER!* 💀\nJawaban: *${game.word}*\n\n`;
    }

    return `${header}${hangman}\n\n📝 *Kata:* ${wordDisplay}\n\n❌ Salah: ${game.wrongGuesses}/${game.maxWrong}\n${guessed ? `🔤 Ditebak: ${guessed}\n` : ''}\n${game.status === 'playing' ? '➡️ Kirim 1 huruf untuk menebak!' : ''}`;
}

export default {
    name: 'tebak',
    title: 'Tebak Kata',
    description: 'Game tebak kata (Hangman) - tebak huruf untuk menemukan kata',
    commands: ['tebak', 'tebakkata', 'hangman'],

    async handler(sock, remoteJid, args, context) {
        const game = games.get(remoteJid);
        const subCmd = (args[0] || '').toLowerCase();

        // Start new game
        if (!game || subCmd === 'start' || subCmd === 'mulai' || subCmd === 'baru') {
            // Pick a random word
            const word = WORDS[Math.floor(Math.random() * WORDS.length)];
            const newGame = createGame(word);
            games.set(remoteJid, newGame);

            await sock.sendMessage(remoteJid, {
                text: `🎮 *TEBAK KATA* 🎮\n\nAyo tebak kata! Kirim 1 huruf untuk mulai menebak.\n\n${getHangmanArt(0)}\n\n📝 *Kata:* ${newGame.display.map(() => '▢').join(' ')}\n\n➡️ *Petunjuk:* Kata terdiri dari ${word.length} huruf\n🔤 *Perintah:* /tebak stop (untuk berhenti)`
            });
            return;
        }

        // Stop game
        if (subCmd === 'stop' || subCmd === 'selesai' || subCmd === 'end') {
            if (game) {
                games.delete(remoteJid);
                await sock.sendMessage(remoteJid, {
                    text: `🛑 Game dihentikan.\nJawabannya: *${game.word}*`
                });
            } else {
                await sock.sendMessage(remoteJid, {
                    text: '❌ Gak ada game yang aktif. Ketik /tebak untuk mulai game baru!'
                });
            }
            return;
        }

        // Check game status
        if (subCmd === 'status' || subCmd === 'cek') {
            if (game) {
                await sock.sendMessage(remoteJid, { text: formatGame(game) });
            } else {
                await sock.sendMessage(remoteJid, {
                    text: '❌ Gak ada game yang aktif. Ketik /tebak untuk mulai!'
                });
            }
            return;
        }

        // Handle letter guess
        if (game) {
            if (game.status !== 'playing') {
                await sock.sendMessage(remoteJid, {
                    text: `${formatGame(game)}\n\nKetik /tebak untuk main lagi!`
                });
                games.delete(remoteJid);
                return;
            }

            const letter = args[0] || '';
            const result = checkGuess(game, letter);

            if (game.status !== 'playing') {
                const finalText = formatGame(game);
                games.delete(remoteJid);
                await sock.sendMessage(remoteJid, { text: finalText });
            } else {
                await sock.sendMessage(remoteJid, { text: `${result.message}\n\n${formatGame(game)}` });
            }
        } else {
            // No active game and no recognized subcommand - show help
            await sock.sendMessage(remoteJid, {
                text: `🎮 *TEBAK KATA* 🎮\n\nGame tebak kata (Hangman)!\n\n*Perintah:*\n• /tebak - Mulai game baru\n• /tebak stop - Berhenti\n• /tebak status - Cek status game\n• Kirim *1 huruf* untuk menebak\n\n_Ketik /tebak untuk mulai bermain!_`
            });
        }
    }
};
