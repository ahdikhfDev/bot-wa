import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerSkill, getSkill, isSkillEnabled, getSkillConfig, setSkillConfig, getAllSkillConfigs, setSkillEnabled, getAllSkills } from '../services/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = new Map();

export async function loadSkills() {
    const files = fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.js') && f !== '_loader.js')
        .sort();

    for (const file of files) {
        try {
            const skill = await import(`./${file}`);
            const s = skill.default;
            if (!s || !s.name) continue;

            // Register in DB (first time)
            registerSkill(s.name, s.title || s.name, s.description || '', s.commands || [], {
                ownerOnly: !!s.ownerOnly,
                groupOnly: !!s.groupOnly,
                hasConfig: !!s.config
            });

            // Store handler
            registry.set(s.name, s);
            console.log(`  ✅ Skill: ${s.name} (/${(s.commands || []).join(', /')})`);
        } catch (err) {
            console.error(`  ❌ Skill load error (${file}):`, err.message);
        }
    }

    console.log(`\n📦 ${registry.size} skills loaded\n`);
    return registry;
}

export function getSkillHandler(name) {
    return registry.get(name) || null;
}

export function findSkillByCommand(cmd) {
    // Check in-memory registry first
    for (const [name, skill] of registry) {
        if ((skill.commands || []).includes(cmd)) {
            if (!isSkillEnabled(name)) return null;
            return skill;
        }
    }
    // Fallback: check DB commands (in case file was edited while bot running)
    const allSkills = getAllSkills();
    for (const dbSkill of allSkills) {
        if ((dbSkill.commands || []).includes(cmd) && dbSkill.enabled) {
            const skill = registry.get(dbSkill.name);
            if (skill) return skill;
        }
    }
    return null;
}

export function findSkillByNaturalLanguage(text) {
    for (const [name, skill] of registry) {
        if (skill.detect && typeof skill.detect === 'function') {
            if (!isSkillEnabled(name)) continue;
            const result = skill.detect(text);
            if (result) return { skill, result };
        }
    }
    return null;
}

export function getSkillNames() {
    return [...registry.keys()];
}

export { isSkillEnabled, getSkill, setSkillEnabled, getSkillConfig, setSkillConfig, getAllSkillConfigs, getAllSkills };
