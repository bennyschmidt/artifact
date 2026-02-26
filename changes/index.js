/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Changes (v0.3.5)
 */

const fs = require('fs');
const path = require('path');

const getStateByHash = require('../utils/getStateByHash');

/**
 * Iterates through the JSON commit files in the active branch folder.
 * @returns {string} A formatted string of commit history.
 */

function log () {
  /**
   * Initialize repository paths and verify the existence of an .art directory
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  if (!fs.existsSync(artifactJsonPath)) {
    throw new Error('No art repository found.');
  }

  /**
   * Retrieve active branch details and locate the history manifest.
   */

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );
  
  const branch = artifactJson.active.branch;
  const branchPath = path.join(artifactPath, 'history/local', branch);
  const manifestPath = path.join(branchPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return 'No commits found.';
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  );

  let output = `Branch: ${branch}\n\n`;

  /**
   * Build the commit history in reverse chronological order.
   */

  for (let i = manifest.commits.length - 1; i >= 0; i--) {
    const hash = manifest.commits[i];
    const commitMasterPath = path.join(branchPath, `${hash}.json`);

    if (fs.existsSync(commitMasterPath)) {
      const commitData = JSON.parse(
        fs.readFileSync(commitMasterPath, 'utf8')
      );

      output += `commit ${commitData.hash}\n`;
      output += `Date: ${new Date(commitData.timestamp).toLocaleString()}\n`;
      output += `\n    ${commitData.message}\n\n`;
    }
  }

  return output;
}

/**
 * Displays line-by-line differences between working directory and the last commit/stage.
 * @returns {object} Formatted diff output and staged file list.
 */

function diff () {
  /**
   * Set up environment roots and retrieve the state of the last committed parent.
   */

  const root = process.cwd();
  const artifactPath = path.join(root, '.art');
  const artifactJsonPath = path.join(artifactPath, 'art.json');

  if (!fs.existsSync(artifactJsonPath)) {
    throw new Error('No art repository found.');
  }

  const artifactJson = JSON.parse(
    fs.readFileSync(artifactJsonPath, 'utf8')
  );

  const activeBranch = artifactJson.active.branch;
  const lastCommitHash = artifactJson.active.parent;
  const lastCommitState = lastCommitHash ? getStateByHash(activeBranch, lastCommitHash) : {};

  /**
   * Scan the working directory for files, excluding the .art internal folder.
   */

  const currentFiles = fs.readdirSync(root, { recursive: true })
    .filter(file => {
      return !file.startsWith('.art') && !fs.statSync(path.join(root, file)).isDirectory();
    });

  const fileDiffs = [];

  /**
   * Calculate differences between current file content and the last known state.
   */

  for (const filePath of currentFiles) {
    const fullPath = path.join(root, filePath);
    const currentBuffer = fs.readFileSync(fullPath);
    const isBinary = currentBuffer.includes(0);

    const currentContent = isBinary ? null : currentBuffer.toString('utf8');
    const previousContent = lastCommitState[filePath] || '';

    if (!isBinary && currentContent !== previousContent) {
      /**
       * Identify the range of changed characters to generate a compact diff.
       */

      let start = 0;

      while (start < previousContent.length && start < currentContent.length && previousContent[start] === currentContent[start]) {
        start++;
      }

      let oldEnd = previousContent.length - 1;
      let newEnd = currentContent.length - 1;

      while (oldEnd >= start && newEnd >= start && previousContent[oldEnd] === currentContent[newEnd]) {
        oldEnd--;
        newEnd--;
      }

      fileDiffs.push({
        file: filePath,
        deleted: previousContent.slice(start, oldEnd + 1),
        added: currentContent.slice(start, newEnd + 1)
      });
    } else if (isBinary) {
      /**
       * Handle binary files by checking existence rather than performing a text-based diff.
       */

      const previousHash = lastCommitState[filePath] ? 'exists' : 'null';

      if (previousHash === 'null') {
        fileDiffs.push({
          file: filePath,
          added: '<Binary Data>',
          deleted: ''
        });
      }
    }
  }

  /**
   * Access the staging area to identify files currently prepared for the next commit.
   */

  const stageDirectory = path.join(artifactPath, 'stage');
  const stageManifestPath = path.join(stageDirectory, 'manifest.json');

  let staged = [];

  if (fs.existsSync(stageManifestPath)) {
    const manifest = JSON.parse(
      fs.readFileSync(stageManifestPath, 'utf8')
    );
    const stagedFilesSet = new Set();

    for (const partName of manifest.parts) {
      const partPath = path.join(stageDirectory, partName);

      if (fs.existsSync(partPath)) {
        const partData = JSON.parse(
          fs.readFileSync(partPath, 'utf8')
        );

        for (const file of Object.keys(partData.changes)) {
          stagedFilesSet.add(file);
        }
      }
    }

    staged = Array.from(stagedFilesSet);
  }

  return {
    fileDiffs,
    staged
  };
}

module.exports = {
  __libraryVersion: '0.3.5',
  __libraryAPIName: 'Changes',
  log,
  diff
};
