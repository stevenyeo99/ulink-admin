#!/usr/bin/env node
// Console user management from the command line (no Users page yet — CONSOLE_DASHBOARD_DESIGN.md step 7).
//
//   npm run user:create -- <username> [--name "Full Name"] [--role super_admin]
//   npm run user:reset-password -- <username>
//   npm run user:disable -- <username>      /  npm run user:enable -- <username>
//
// Passwords are typed at a hidden prompt — never passed on the command line, never stored in code.

require('dotenv').config({ quiet: true });
const readline = require('readline');
const { sequelize, User } = require('../db/models');
const { ROLES, MIN_PASSWORD_LENGTH, hashPassword } = require('../modules/auth/auth');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) rl.output.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function askNewPassword() {
  const password = await askHidden(`New password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  if ((await askHidden('Type it again: ')) !== password) throw new Error("The two passwords don't match.");
  return hashPassword(password);
}

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main() {
  const [command, rawUsername, ...rest] = process.argv.slice(2);
  const username = String(rawUsername || '').trim().toLowerCase();
  if (!username) throw new Error('Give a username, e.g. npm run user:create -- ulink');

  if (command === 'create') {
    const role = option(rest, 'role') || 'super_admin';
    if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
    if (await User.findOne({ where: { username } })) throw new Error(`User "${username}" already exists.`);
    const passwordHash = await askNewPassword();
    await User.create({ username, name: option(rest, 'name') || null, role, passwordHash });
    console.log(`Created ${username} (${role}).`);
  } else {
    const user = await User.findOne({ where: { username } });
    if (!user) throw new Error(`No user "${username}".`);
    if (command === 'reset-password') await user.update({ passwordHash: await askNewPassword() });
    else if (command === 'disable') await user.update({ isActive: false });
    else if (command === 'enable') await user.update({ isActive: true });
    else throw new Error('Command must be create, reset-password, disable or enable.');
    console.log(`${command} done for ${username}.`);
  }
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
