/**
 * art - Modern version control.
 * Module: Contributions (v0.3.0)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { checkout } = require('../branching/index.js');

const ARTIFACT_HOST = pkg.artConfig.host || 'http://localhost:1337';

/**
 * Configures the single URL endpoint in art.json for synchronization.
 */

function remote (input) {
  const artPath = path.join(process.cwd(), '.art', 'art.json');
  if (!fs.existsSync(artPath)) throw new Error('No art repository found.');

  const artJson = JSON.parse(fs.readFileSync(artPath, 'utf8'));

  if (input) {
    let finalUrl = input;
    if (input.includes('/') && !input.startsWith('http')) {
      finalUrl = `${ARTIFACT_HOST}/${input}`;
    }
    artJson.remote = finalUrl;
    fs.writeFileSync(artPath, JSON.stringify(artJson, null, 2));
  }

  return artJson.remote;
}

/**
 * Downloads paginated JSON diff files from the remote server.
 */

async function fetchRemote () {
  const artPath = path.join(process.cwd(), '.art');
  const artJson = JSON.parse(fs.readFileSync(path.join(artPath, 'art.json'), 'utf8'));

  if (!artJson.remote) throw new Error('Remote URL not configured.');

  const branch = artJson.active.branch;
  const token = artJson.configuration.personalAccessToken;

  const remoteParts = artJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();

  const remoteBranchPath = path.join(artPath, 'history/remote', branch);

  if (!fs.existsSync(remoteBranchPath)) {
    fs.mkdirSync(remoteBranchPath, { recursive: true });
  }

  const response = await fetch(`${ARTIFACT_HOST}/manifest`, {
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
    const commitMasterPath = path.join(remoteBranchPath, `${commitHash}.json`);

    if (!fs.existsSync(commitMasterPath)) {
      const commitRes = await fetch(`${ARTIFACT_HOST}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle, repo, branch, hash: commitHash,
          ...(token && { personalAccessToken: token })
        })
      });

      const commitMaster = await commitRes.json();

      fs.writeFileSync(commitMasterPath, JSON.stringify(commitMaster, null, 2));

      for (const partName of commitMaster.parts) {
        const partPath = path.join(remoteBranchPath, partName);

        if (!fs.existsSync(partPath)) {
          const partRes = await fetch(`${ARTIFACT_HOST}/commit/part`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              handle, repo, branch, partName,
              ...(token && { personalAccessToken: token })
            })
          });

          const partData = await partRes.json();

          fs.writeFileSync(partPath, JSON.stringify(partData, null, 2));
        }
      }
    }
  }

  fs.writeFileSync(path.join(remoteBranchPath, 'manifest.json'), JSON.stringify(remoteManifest, null, 2));

  return `Fetched remote history for branch: ${branch}`;
}

/**
 * Applies remote paginated commits to local branch.
 */

async function pull () {
  const artPath = path.join(process.cwd(), '.art');
  const artJson = JSON.parse(fs.readFileSync(path.join(artPath, 'art.json'), 'utf8'));
  const branch = artJson.active.branch;

  await fetchRemote();

  const remoteBranchPath = path.join(artPath, 'history/remote', branch);
  const localBranchPath = path.join(artPath, 'history/local', branch);

  const remoteManifest = JSON.parse(fs.readFileSync(path.join(remoteBranchPath, 'manifest.json'), 'utf8'));
  const localManifest = JSON.parse(fs.readFileSync(path.join(localBranchPath, 'manifest.json'), 'utf8'));

  const newCommits = remoteManifest.commits.filter(hash => !localManifest.commits.includes(hash));

  if (newCommits.length === 0) {
    return 'Already up to date.';
  }

  for (const commitHash of newCommits) {
    const masterData = fs.readFileSync(path.join(remoteBranchPath, `${commitHash}.json`), 'utf8');
    const masterJson = JSON.parse(masterData);

    fs.writeFileSync(path.join(localBranchPath, `${commitHash}.json`), masterData);

    for (const partName of masterJson.parts) {
      const partContent = fs.readFileSync(path.join(remoteBranchPath, partName), 'utf8');

      fs.writeFileSync(path.join(localBranchPath, partName), partContent);
    }

    localManifest.commits.push(commitHash);
  }

  fs.writeFileSync(path.join(localBranchPath, 'manifest.json'), JSON.stringify(localManifest, null, 2));
  checkout(branch);

  return `Applied ${newCommits.length} commits.`;
}

/**
 * Uploads local commits via the two-step /push and /commit/part flow.
 */

async function push () {
  const artPath = path.join(process.cwd(), '.art');
  const artJson = JSON.parse(fs.readFileSync(path.join(artPath, 'art.json'), 'utf8'));

  if (!artJson.remote) throw new Error('Remote URL not configured.');

  const branch = artJson.active.branch;
  const token = artJson.configuration.personalAccessToken;
  const remoteParts = artJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();

  const localBranchPath = path.join(artPath, 'history/local', branch);
  const remoteBranchPath = path.join(artPath, 'history/remote', branch);
  const localManifest = JSON.parse(fs.readFileSync(path.join(localBranchPath, 'manifest.json'), 'utf8'));

  const response = await fetch(`${ARTIFACT_HOST}/manifest`, {
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

  let rootData = null;

  if (remoteManifest.commits.length === 0) {
    const rootMasterPath = path.join(artPath, 'root/manifest.json');

    if (fs.existsSync(rootMasterPath)) {
      const master = JSON.parse(fs.readFileSync(rootMasterPath, 'utf8'));
      const parts = {};

      for (const partName of master.parts) {
        parts[partName] = JSON.parse(fs.readFileSync(path.join(artPath, 'root', partName), 'utf8'));
      }

      rootData = { master, parts };
    }
  }

  const currentRemoteManifestPath = path.join(remoteBranchPath, 'manifest.json');
  const currentRemoteManifest = fs.existsSync(currentRemoteManifestPath)
    ? JSON.parse(fs.readFileSync(currentRemoteManifestPath, 'utf8'))
    : { commits: [] };

  for (const commitHash of missingCommits) {
    const commitMaster = JSON.parse(fs.readFileSync(path.join(localBranchPath, `${commitHash}.json`), 'utf8'));

    const pushRes = await fetch(`${ARTIFACT_HOST}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle, repo, branch, commit: commitMaster,

        ...(rootData && { root: rootData }),

        ...(token && { personalAccessToken: token })
      })
    });

    if (!pushRes.ok) throw new Error(`Server rejected push for commit ${commitHash}`);

    rootData = null;

    for (const partName of commitMaster.parts) {
      const partData = JSON.parse(fs.readFileSync(path.join(localBranchPath, partName), 'utf8'));

      const partRes = await fetch(`${ARTIFACT_HOST}/commit/part`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle, repo, branch, partName, partData,
          ...(token && { personalAccessToken: token })
        })
      });

      if (!partRes.ok) throw new Error(`Server failed to receive part ${partName}`);
    }

    currentRemoteManifest.commits.push(commitHash);
    fs.writeFileSync(currentRemoteManifestPath, JSON.stringify(currentRemoteManifest, null, 2));
  }

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
