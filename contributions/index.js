/**
 * dep - Modern version control.
 * Module: Contributions (v0.1.2)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { checkout } = require('../branching/index.js');

const DEP_HOST = pkg.depConfig.host || 'http://localhost:1337';

/**
 * Configures the single URL endpoint in dep.json for synchronization.
 * Supports full URLs or "handle/repo" slugs.
 */

function remote (input) {
  const depPath = path.join(process.cwd(), '.dep', 'dep.json');

  if (!fs.existsSync(depPath)) {
    throw new Error('No dep repository found.');
  }

  const manifest = JSON.parse(fs.readFileSync(depPath, 'utf8'));

  if (input) {
    let finalUrl = input;

    if (input.includes('/') && !input.startsWith('http')) {
      finalUrl = `${DEP_HOST}/${input}`;
    }

    manifest.remote = finalUrl;
    fs.writeFileSync(depPath, JSON.stringify(manifest, null, 2));
  }

  return manifest.remote;
}

/**
 * Downloads JSON diff files from the remote server via POST.
 */

async function fetchRemote () {
  const depPath = path.join(process.cwd(), '.dep');
  const depJson = JSON.parse(fs.readFileSync(path.join(depPath, 'dep.json'), 'utf8'));

  if (!depJson.remote) {
    throw new Error('Remote URL not configured. Use "dep remote <url|slug>".');
  }

  const branch = depJson.active.branch;
  const token = depJson.configuration.personalAccessToken;

  const remoteParts = depJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();

  const remoteBranchPath = path.join(depPath, 'history/remote', branch);

  if (!fs.existsSync(remoteBranchPath)) {
    fs.mkdirSync(remoteBranchPath, { recursive: true });
  }

  const response = await fetch(`${DEP_HOST}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'history',
      handle,
      repo,
      branch,

      ...(token && { personalAccessToken: token })
    })
  });

  const remoteManifest = await response.json();

  for (const commitHash of remoteManifest.commits) {
    const commitFilePath = path.join(remoteBranchPath, `${commitHash}.json`);

    if (!fs.existsSync(commitFilePath)) {
      const commitResponse = await fetch(`${DEP_HOST}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle,
          repo,
          branch,
          hash: commitHash,

          ...(token && { personalAccessToken: token })
        })
      });

      const commitDiff = await commitResponse.json();

      fs.writeFileSync(commitFilePath, JSON.stringify(commitDiff, null, 2));
    }
  }

  fs.writeFileSync(
    path.join(remoteBranchPath, 'manifest.json'),
    JSON.stringify(remoteManifest, null, 2)
  );

  return `Fetched remote history for branch: ${branch}`;
}

/**
 * Performs a fetch and applies remote JSON diffs to local branch and files.
 */

async function pull () {
  const depPath = path.join(process.cwd(), '.dep');
  const depJson = JSON.parse(fs.readFileSync(path.join(depPath, 'dep.json'), 'utf8'));
  const branch = depJson.active.branch;

  await fetchRemote();

  const remoteManifestPath = path.join(depPath, 'history/remote', branch, 'manifest.json');
  const remoteManifest = JSON.parse(fs.readFileSync(remoteManifestPath, 'utf8'));

  const localManifestPath = path.join(depPath, 'history/local', branch, 'manifest.json');
  const localManifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));

  const newCommits = remoteManifest.commits.filter(hash => !localManifest.commits.includes(hash));

  if (newCommits.length === 0) {
    return 'Already up to date.';
  }

  for (const commitHash of newCommits) {
    const remoteCommitFile = path.join(depPath, 'history/remote', branch, `${commitHash}.json`);
    const remoteData = fs.readFileSync(remoteCommitFile, 'utf8');

    fs.writeFileSync(
      path.join(depPath, 'history/local', branch, `${commitHash}.json`),
      remoteData
    );

    localManifest.commits.push(commitHash);
  }

  fs.writeFileSync(localManifestPath, JSON.stringify(localManifest, null, 2));
  checkout(branch);

  return `Applied ${newCommits.length} commits.`;
}

/**
 * Uploads local JSON diffs that do not exist in the remote history.
 */

async function push () {
  const depPath = path.join(process.cwd(), '.dep');
  const depJson = JSON.parse(fs.readFileSync(path.join(depPath, 'dep.json'), 'utf8'));

  if (!depJson.remote) {
    throw new Error('Remote URL not configured.');
  }

  const branch = depJson.active.branch;
  const token = depJson.configuration.personalAccessToken;

  const remoteParts = depJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();

  const localManifest = JSON.parse(fs.readFileSync(path.join(depPath, 'history/local', branch, 'manifest.json'), 'utf8'));

  const response = await fetch(`${DEP_HOST}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'history',
      handle,
      repo,
      branch,

      ...(token && { personalAccessToken: token })
    })
  });

  const remoteManifest = await response.json();

  const missingCommits = localManifest.commits.filter(hash => !remoteManifest.commits.includes(hash));

  if (missingCommits.length === 0) {
    return 'Everything up to date.';
  }

  for (const commitHash of missingCommits) {
    const commitData = JSON.parse(fs.readFileSync(path.join(depPath, 'history/local', branch, `${commitHash}.json`), 'utf8'));

    await fetch(`${DEP_HOST}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle,
        repo,
        branch,
        commit: commitData,

        ...(token && { personalAccessToken: token })
      })
    });
  }

  const remoteManifestPath = path.join(depPath, 'history/remote', branch, 'manifest.json');

  fs.writeFileSync(remoteManifestPath, JSON.stringify(localManifest, null, 2));

  return `Pushed ${missingCommits.length} commits to remote.`;
}

module.exports = {
  __libraryVersion: pkg.version,
  __libraryAPIName: 'Contributions',
  remote,
  fetch: fetchRemote,
  pull,
  push
};
