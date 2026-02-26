#!/usr/bin/env node

/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * CLI (v0.3.5)
 */

const artifact = require('../index.js');
const path = require('path');

/**
 * Extract command line args
 */

const [,, command, ...args] = process.argv;

/**
 * Console text color constants
 */

const {
  RED,
  GREEN,
  RESET,
  GRAY
} = require('../utils/constants.js');

async function run() {
  try {
    switch (command) {

      /**
       * init
       * Initialize a new local repository.
       */

      case 'init':
        console.log(artifact.init(args[0]));

        break;

      /**
       * clone
       * Clone an existing repository from a remote source.
       */

      case 'clone':
        if (!args[0]) {
          throw new Error('Specify a repository slug (handle/repo).');
        }

        const tokenIndex = args.indexOf('--token');
        const cliToken = (tokenIndex !== -1) && args[tokenIndex + 1];

        console.log(
          await artifact.clone(args[0], cliToken)
        );

        break;

      /**
       * config
       * Set or update contributor configuration data.
       */

      case 'config':
        console.log(artifact.config(args[0], args[1]));

        break;

      /**
       * status
       * Display the state of the working directory and the staging area.
       */

      case 'status':
        const {
          activeBranch,
          lastCommit,
          staged,
          modified,
          untracked,
          ignored
        } = artifact.status();

        console.log(`On branch ${activeBranch}`);
        console.log(`Last commit: ${lastCommit || 'None'}`);

        if (staged.length > 0) {
          console.log('\nChanges to be committed:');

          for (const file of staged) {
            console.log(`${GREEN}\t${file}${RESET}`);
          }
        }

        if (modified.length > 0) {
          console.log('\nChanges not staged for commit:');

          for (const file of modified) {
            console.log(`${RED}\tmodified: ${file}${RESET}`);
          }
        }

        if (untracked.length > 0) {
          console.log('\nUntracked files:');

          for (const file of untracked) {
            console.log(`${RED}\t${file}${RESET}`);
          }
        }

        if (ignored && ignored.length > 0) {
          console.log('\nIgnored files:');

          const compressedIgnored = new Set();

          for (const file of ignored) {
            const parts = file.split(path.sep);

            if (parts.length > 1) {
              compressedIgnored.add(`${parts[0]}${path.sep}`);
            } else {
              compressedIgnored.add(file);
            }
          }

          for (const file of compressedIgnored) {
            console.log(`${GRAY}\t${file}${RESET}`);
          }
        }

        if (untracked.length === 0 && modified.length === 0 && staged.length === 0) {
          console.log('\nNothing to commit, working tree clean.');
        }

        break;

      /**
       * add
       * Add file contents to the staging area.
       */

      case 'add':
        if (!args[0]) {
          throw new Error('Specify a file path to add.');
        }

        console.log(artifact.add(args[0]));

        break;

      /**
       * commit
       * Record changes to the repository with a descriptive message.
       */

      case 'commit':
        if (!args[0]) {
          throw new Error('Specify a commit message.');
        }

        console.log(artifact.commit(args[0]));

        break;

      /**
       * branch
       * List, create, or delete branches.
       */

      case 'branch':
        const deleteFlags = ['--delete', '-d', '-D'];
        const isDelete = deleteFlags.includes(args[0]);
        const branchName = isDelete ? args[1] : args[0];

        const branches = artifact.branch({ name: branchName, isDelete });

        if (Array.isArray(branches)) {
          for (const branch of branches) {
            console.log(branch);
          }
        } else {
          console.log(branches);
        }

        break;

      /**
       * checkout
       * Switch branches or restore working tree files.
       */

      case 'checkout':
        if (!args[0]) {
          throw new Error('Specify a branch name.');
        }

        console.log(artifact.checkout(args[0]));

        break;

      /**
       * merge
       * Join two or more development histories together.
       */

      case 'merge':
        if (!args[0]) {
          throw new Error('Specify a target branch to merge.');
        }

        console.log(artifact.merge(args[0]));

        break;

      /**
       * remote
       * Manage set of tracked repositories.
       */

      case 'remote':
        console.log(artifact.remote(args[0]));

        break;

      /**
       * fetch
       * Download objects and refs from another repository.
       */

      case 'fetch':
        console.log(
          await artifact.fetch()
        );

        break;

      /**
       * pull
       * Fetch from and integrate with another repository or a local branch.
       */

      case 'pull':
        console.log(
          await artifact.pull()
        );

        break;

      /**
       * push
       * Update remote refs along with associated objects.
       */

      case 'push':
        console.log(
          await artifact.push()
        );

        await artifact.fetch()

        break;

      /**
       * log
       * Show the commit history logs.
       */

      case 'log':
        console.log(artifact.log());

        break;

      /**
       * diff
       * Show changes between commits, commit and working tree, etc.
       */

      case 'diff':
        const { fileDiffs, staged: diffStaged } = artifact.diff();

        if (fileDiffs.length === 0 && diffStaged.length === 0) {
          console.log('No changes detected.');

          break;
        }

        for (const diffFile of fileDiffs) {
          console.log(`diff --art a/${diffFile.file} b/${diffFile.file}`);

          if (diffFile.deleted) {
            for (const line of diffFile.deleted.split('\n')) {
              console.log(`${RED}- ${line}${RESET}`);
            }
          }

          if (diffFile.added) {
            for (const line of diffFile.added.split('\n')) {
              console.log(`${GREEN}+ ${line}${RESET}`);
            }
          }

          console.log('');
        }

        if (diffStaged.length > 0) {
          console.log('--- Staged Changes ---');

          for (const file of diffStaged) {
            console.log(`staged: ${GREEN}${file}${RESET}`);
          }
        }

        break;

      /**
       * stash
       * Stash the changes in a dirty working directory away.
       */

      case 'stash':
        const isPop = args[0] === 'pop';
        const isList = args[0] === 'list';
        const result = artifact.stash({ pop: isPop, list: isList });

        if (isList && Array.isArray(result)) {
          if (result.length === 0) {
            console.log('No stashes found.');
          } else {
            console.log('Saved stashes:');

            for (const stash of result) {
              console.log(`${stash.id}: WIP on branch: (${stash.date})`);
            }
          }
        } else {
          console.log(result);
        }

        break;

      /**
       * reset
       * Reset current HEAD to the specified state.
       */

      case 'reset':
        console.log(artifact.reset(args[0]));

        break;

      /**
       * remove
       * Remove files from the working tree and from the index.
       */

      case 'remove':
      case 'rm':
        if (!args[0]) {
          throw new Error('Specify a file path to remove.');
        }

        console.log(artifact.rm(args[0]));

        break;

      /**
       * version
       * Output the current version of the Artifact CLI.
       */

      case '--version':
      case '-v':
        console.log(`art version ${artifact.version}`);

        break;

      /**
       * help
       * Display help information about Artifact commands.
       */

      case 'help':
      default:
        console.log('Usage: art <command> [args]');
        console.log('Available commands: init, clone, status, add, commit, branch, checkout, merge, remote, fetch, pull, push, log, diff, stash, reset, rm');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Execute the command line interface

run();
