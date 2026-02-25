#!/usr/bin/env node

/**
 * art - Modern version control.
 * CLI (v0.3.2)
 */

const art = require('../index.js');
const path = require('path');

const [,, command, ...args] = process.argv;

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';

async function run() {
  try {
    switch (command) {
      case 'init':
        console.log(art.init(args[0]));

        break;

      case 'clone':
        if (!args[0]) {
          throw new Error('Specify a repository slug (handle/repo).');
        }

        const tokenIndex = args.indexOf('--token');
        const cliToken = (tokenIndex !== -1) && args[tokenIndex + 1];

        console.log(await art.clone(args[0], cliToken));

        break;

      case 'config':
        console.log(art.config(args[0], args[1]));

        break;

      case 'status':
        const {
          activeBranch,
          lastCommit,
          staged,
          modified,
          untracked,
          ignored
        } = art.status();

        console.log(`On branch ${activeBranch}`);
        console.log(`Last commit: ${lastCommit || 'None'}`);

        if (staged.length > 0) {
          console.log('\nChanges to be committed:');
          staged.forEach(f => console.log(`${GREEN}\t${f}${RESET}`));
        }

        if (modified.length > 0) {
          console.log('\nChanges not staged for commit:');
          modified.forEach(f => console.log(`${RED}\tmodified: ${f}${RESET}`));
        }

        if (untracked.length > 0) {
          console.log('\nUntracked files:');
          untracked.forEach(f => console.log(`${RED}\t${f}${RESET}`));
        }

        if (ignored && ignored.length > 0) {
          console.log('\nIgnored files:');

          const compressedIgnored = new Set();

          ignored.forEach(f => {
            const parts = f.split(path.sep);
            if (parts.length > 1) {
              compressedIgnored.add(`${parts[0]}${path.sep}`);
            } else {
              compressedIgnored.add(f);
            }
          });

          compressedIgnored.forEach(f => console.log(`${GRAY}\t${f}${RESET}`));
        }

        if (untracked.length === 0 && modified.length === 0 && staged.length === 0) {
          console.log('\nNothing to commit, working tree clean.');
        }

        break;

      case 'add':
        if (!args[0]) throw new Error('Specify a file path to add.');

        console.log(art.add(args[0]));

        break;

      case 'commit':
        if (!args[0]) throw new Error('Specify a commit message.');
        console.log(art.commit(args[0]));

        break;

      case 'branch':
        const deleteFlags = ['--delete', '-d', '-D'];
        const isDelete = deleteFlags.includes(args[0]);
        const branchName = isDelete ? args[1] : args[0];

        const branches = art.branch({ name: branchName, isDelete });

        if (Array.isArray(branches)) {
          for (const b of branches) console.log(b);
        } else {
          console.log(branches);
        }

        break;

      case 'checkout':
        if (!args[0]) throw new Error('Specify a branch name.');

        console.log(art.checkout(args[0]));

        break;

      case 'merge':
        if (!args[0]) throw new Error('Specify a target branch to merge.');

        console.log(art.merge(args[0]));

        break;

      case 'remote':
        console.log(art.remote(args[0]));

        break;

      case 'fetch':
        console.log(await art.fetch());

        break;

      case 'pull':
        console.log(await art.pull());

        break;

      case 'push':
        console.log(await art.push());

        await art.fetch()

        break;

      case 'log':
        console.log(art.log());

        break;

      case 'diff':
        const { fileDiffs, staged: diffStaged } = art.diff();

        if (fileDiffs.length === 0 && diffStaged.length === 0) {
          console.log('No changes detected.');

          break;
        }

        for (const df of fileDiffs) {
          console.log(`diff --art a/${df.file} b/${df.file}`);

          if (df.deleted) {
            df.deleted.split('\n').forEach(line => {
              console.log(`${RED}- ${line}${RESET}`);
            });
          }

          if (df.added) {
            df.added.split('\n').forEach(line => {
              console.log(`${GREEN}+ ${line}${RESET}`);
            });
          }

          console.log('');
        }

        if (diffStaged.length > 0) {
          console.log('--- Staged Changes ---');
          diffStaged.forEach(f => console.log(`staged: ${GREEN}${f}${RESET}`));
        }

        break;

      case 'stash':
        const isPop = args[0] === 'pop';
        const isList = args[0] === 'list';
        const result = art.stash({ pop: isPop, list: isList });

        if (isList && Array.isArray(result)) {
          if (result.length === 0) {
            console.log('No stashes found.');
          } else {
            console.log('Saved stashes:');

            for (const s of result) {
              console.log(`${s.id}: WIP on branch: (${s.date})`);
            }
          }
        } else {
          console.log(result);
        }

        break;

      case 'reset':
        console.log(art.reset(args[0]));

        break;

      case 'remove':
      case 'rm':
        if (!args[0]) throw new Error('Specify a file path to remove.');

        console.log(art.rm(args[0]));

        break;

      case '--version':
      case '-v':
        console.log(`art version ${art.version}`);

        break;

      default:
        console.log('Usage: art <command> [arguments]');
        console.log('Available commands: init, clone, status, add, commit, branch, checkout, merge, remote, fetch, pull, push, log, diff, stash, reset, rm');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

run();
