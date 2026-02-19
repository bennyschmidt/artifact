#!/usr/bin/env node

/**
 * dep - Modern version control.
 * CLI (v0.1.9)
 */

const dep = require('../index.js');

const [,, command, ...args] = process.argv;

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

async function run() {
  try {
    switch (command) {
      case 'init':
        console.log(dep.init(args[0]));

        break;

      case 'clone':
        if (!args[0]) {
          throw new Error('Specify a repository slug (handle/repo).');
        }

        const tokenIndex = args.indexOf('--token');
        const cliToken = (tokenIndex !== -1) && args[tokenIndex + 1];

        console.log(await dep.clone(args[0], cliToken));

        break;

      case 'config':
        console.log(dep.config(args[0], args[1]));

        break;

      case 'status':
        const {
          activeBranch,
          lastCommit,
          staged,
          modified,
          untracked
        } = dep.status();

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

        if (untracked.length === 0 && modified.length === 0 && staged.length === 0) {
          console.log('Nothing to commit.');
        }

        break;

      case 'add':
        if (!args[0]) throw new Error('Specify a file path to add.');

        console.log(dep.add(args[0]));

        break;

      case 'commit':
        if (!args[0]) throw new Error('Specify a commit message.');
        console.log(dep.commit(args[0]));

        break;

      case 'branch':
        const deleteFlags = ['--delete', '-d', '-D'];
        const isDelete = deleteFlags.includes(args[0]);
        const branchName = isDelete ? args[1] : args[0];

        const branches = dep.branch({ name: branchName, isDelete });

        if (Array.isArray(branches)) {
          for (const b of branches) console.log(b);
        } else {
          console.log(branches);
        }

        break;

      case 'checkout':
        if (!args[0]) throw new Error('Specify a branch name.');

        console.log(dep.checkout(args[0]));

        break;

      case 'merge':
        if (!args[0]) throw new Error('Specify a target branch to merge.');

        console.log(dep.merge(args[0]));

        break;

      case 'remote':
        console.log(dep.remote(args[0]));

        break;

      case 'fetch':
        console.log(await dep.fetch());

        break;

      case 'pull':
        console.log(await dep.pull());

        break;

      case 'push':
        console.log(await dep.push());

        break;

      case 'log':
        console.log(dep.log());

        break;

      case 'diff':
        const { fileDiffs, staged } = dep.diff();

        if (fileDiffs.length === 0 && staged.length === 0) {
          console.log('No changes detected.');

          break;
        }

        for (const df of fileDiffs) {
          console.log(`diff --dep a/${df.file} b/${df.file}`);

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

        if (staged.length > 0) {
          console.log('--- Staged Changes ---');
          staged.forEach(f => console.log(`staged: ${GREEN}${f}${RESET}`));
        }

        break;

      case 'stash':
        const isPop = args[0] === 'pop';
        const isList = args[0] === 'list';
        const result = dep.stash({ pop: isPop, list: isList });

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
        console.log(dep.reset(args[0]));

        break;

      case 'rm':
        if (!args[0]) throw new Error('Specify a file path to remove.');

        console.log(dep.rm(args[0]));

        break;

      case '--version':
      case '-v':
        console.log(`dep version ${dep.version}`);

        break;

      default:
        console.log('Usage: dep <command> [arguments]');
        console.log('Available commands: init, clone, status, add, commit, branch, checkout, merge, remote, fetch, pull, push, log, diff, stash, reset, rm');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

run();
