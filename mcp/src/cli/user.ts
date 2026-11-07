#!/usr/bin/env node
// User administration for the OAuth login.
//   npm run user -- add <email> [--password <pwd>]
//   npm run user -- list
//   npm run user -- passwd <email> [--password <pwd>]
//   npm run user -- disable <email> | enable <email>
//   npm run user -- revoke-tokens <email>
//   npm run user -- delete <email>
import readline from "node:readline";
import { Writable } from "node:stream";
import { config } from "../config.js";
import {
    createUser,
    deleteUser,
    getUserByEmail,
    listUsers,
    revokeUserTokens,
    setDisabled,
    setPassword,
} from "../auth/users.js";

const MIN_PASSWORD_LENGTH = 10;

function usage(): never {
    console.error(`Usage:
  user add <email> [--password <pwd>]
  user list
  user passwd <email> [--password <pwd>]
  user disable <email>
  user enable <email>
  user revoke-tokens <email>
  user delete <email>

Database: ${config.DB_PATH}`);
    process.exit(1);
}

function promptHidden(question: string): Promise<string> {
    let muted = false;
    const output = new Writable({
        write(chunk, _encoding, callback) {
            if (!muted) process.stdout.write(chunk);
            callback();
        },
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write("\n");
            resolve(answer);
        });
        muted = true;
    });
}

async function readPassword(args: string[]): Promise<string> {
    const idx = args.indexOf("--password");
    let password: string;
    if (idx >= 0) {
        password = args[idx + 1] ?? "";
    } else {
        password = await promptHidden("Password: ");
        const confirm = await promptHidden("Confirm password: ");
        if (password !== confirm) {
            console.error("Passwords do not match");
            process.exit(1);
        }
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(`Password must have at least ${MIN_PASSWORD_LENGTH} characters`);
        process.exit(1);
    }
    return password;
}

function requireUser(email: string | undefined) {
    if (!email) usage();
    const user = getUserByEmail(email);
    if (!user) {
        console.error(`User not found: ${email}`);
        process.exit(1);
    }
    return user;
}

async function main() {
    const [command, email, ...rest] = process.argv.slice(2);

    switch (command) {
        case "add": {
            if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) usage();
            if (getUserByEmail(email)) {
                console.error(`User already exists: ${email}`);
                process.exit(1);
            }
            const user = await createUser(email, await readPassword(rest));
            console.log(`Created user ${user.email} (${user.id})`);
            break;
        }
        case "list": {
            const users = listUsers();
            if (users.length === 0) console.log("No users");
            for (const u of users) {
                console.log(`${u.email}\t${u.disabled ? "disabled" : "active"}\tcreated ${new Date(u.createdAt * 1000).toISOString()}`);
            }
            break;
        }
        case "passwd": {
            const user = requireUser(email);
            await setPassword(user.id, await readPassword(rest));
            revokeUserTokens(user.id);
            console.log(`Password changed for ${user.email}; existing sessions were revoked`);
            break;
        }
        case "disable": {
            const user = requireUser(email);
            setDisabled(user.id, true);
            revokeUserTokens(user.id);
            console.log(`Disabled ${user.email}`);
            break;
        }
        case "enable": {
            const user = requireUser(email);
            setDisabled(user.id, false);
            console.log(`Enabled ${user.email}`);
            break;
        }
        case "revoke-tokens": {
            const user = requireUser(email);
            revokeUserTokens(user.id);
            console.log(`Revoked all tokens and plugin pairings of ${user.email}`);
            break;
        }
        case "delete": {
            const user = requireUser(email);
            deleteUser(user.id);
            console.log(`Deleted ${user.email}`);
            break;
        }
        default:
            usage();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
