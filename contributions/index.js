/**
 * Artifact - Modern version control.
 * @author Benny Schmidt (https://github.com/bennyschmidt)
 * @project https://github.com/bennyschmidt/artifact
 * Module: Contributions (v0.3.5)
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { checkout } = require('../branching/index.js');

const ARTIFACT_HOST = pkg.artConfig.host || 'http://localhost:1337';

/**
 * Configures the single URL endpoint in art.json for synchronization.
 * @param {string} input - The remote URL or slug.
 * @returns {string} The updated remote URL.
 */

function remote (input) {
  /**
   * Validate the existence of the repository configuration before proceeding.
   */

  const artifactPath = path.join(process.cwd(), '.art', 'art.json');

  if (!fs.existsSync(artifactPath)) {
    throw new Error('No art repository found.');
  }

  const artJson = JSON.parse(
    fs.readFileSync(artifactPath, 'utf8')
  );

  /**
   * Normalize the input URL.
   * If a slug (handle/repo) is provided, prepend the default host.
   */

  if (input) {
    let finalUrl = input;

    if (input.includes('/') && !input.startsWith('http')) {
      finalUrl = `${ARTIFACT_HOST}/${input}`;
    }

    artJson.remote = finalUrl;
    fs.writeFileSync(artifactPath, JSON.stringify(artJson, null, 2));
  }

  return artJson.remote;
}

/**
 * Downloads paginated JSON diff files from the remote server.
 * @returns {Promise<string>} Success message.
 */

async function fetchRemote () {
  /**
   * Load local configuration and extract remote repository metadata.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const artifactJson = JSON.parse(
    fs.readFileSync(path.join(artifactPath, 'art.json'), 'utf8')
  );

  if (!artifactJson.remote) {
    throw new Error('Remote URL not configured.');
  }

  const branch = artifactJson.active.branch;
  const token = artifactJson.configuration.personalAccessToken;
  const remoteParts = artifactJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();
  const remoteBranchPath = path.join(artifactPath, 'history/remote', branch);

  /**
   * Ensure the remote history directory exists for the current branch.
   */

  if (!fs.existsSync(remoteBranchPath)) {
    fs.mkdirSync(remoteBranchPath, { recursive: true });
  }

  /**
   * Request the commit manifest from the remote server.
   */

  const response = await fetch(
    `${ARTIFACT_HOST}/manifest`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'history',
        handle,
        repo,
        branch,

        ...(token && { personalAccessToken: token })
      })
    }
  );

  const remoteManifest = await response.json();

  /**
   * Synchronize missing commits and their respective file parts from the server.
   */

  for (const commitHash of remoteManifest.commits) {
    const commitMasterPath = path.join(remoteBranchPath, `${commitHash}.json`);

    if (!fs.existsSync(commitMasterPath)) {
      const commitRes = await fetch(
        `${ARTIFACT_HOST}/commit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle, repo, branch, hash: commitHash,

            ...(token && { personalAccessToken: token })
          })
        }
      );

      const commitMaster = await commitRes.json();

      fs.writeFileSync(commitMasterPath, JSON.stringify(commitMaster, null, 2));

      for (const partName of commitMaster.parts) {
        const partPath = path.join(remoteBranchPath, partName);

        if (!fs.existsSync(partPath)) {
          const partRes = await fetch(
            `${ARTIFACT_HOST}/part`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'history',
                handle,
                repo,
                branch,
                partName,

                ...(token && { personalAccessToken: token })
              })
            }
          );

          const partData = await partRes.json();

          fs.writeFileSync(partPath, JSON.stringify(partData, null, 2));
        }
      }
    }
  }

  /**
   * Update the local remote-tracking manifest.
   */

  fs.writeFileSync(
    path.join(remoteBranchPath, 'manifest.json'),
    JSON.stringify(remoteManifest, null, 2)
  );

  return `Fetched remote history for branch: ${branch}`;
}

/**
 * Applies remote paginated commits to local branch and updates the working tree.
 * @returns {Promise<string>} Success message.
 */

async function pull () {
  /**
   * Initialize pull by fetching the latest remote data.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const artifactJson = JSON.parse(
    fs.readFileSync(path.join(artifactPath, 'art.json'), 'utf8')
  );
  const branch = artifactJson.active.branch;

  await fetchRemote();

  /**
   * Compare local and remote manifests to identify new commits.
   */

  const remoteBranchPath = path.join(artifactPath, 'history/remote', branch);
  const localBranchPath = path.join(artifactPath, 'history/local', branch);

  const remoteManifest = JSON.parse(
    fs.readFileSync(path.join(remoteBranchPath, 'manifest.json'), 'utf8')
  );

  const localManifest = JSON.parse(
    fs.readFileSync(path.join(localBranchPath, 'manifest.json'), 'utf8')
  );

  const newCommits = [];

  for (const hash of remoteManifest.commits) {
    if (!localManifest.commits.includes(hash)) {
      newCommits.push(hash);
    }
  }

  if (newCommits.length === 0) {
    return 'Already up to date.';
  }

  /**
   * Transfer commit files and data parts from remote history to local history.
   */

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

  /**
   * Finalize the pull by updating the local manifest and reconstructing the working directory.
   */

  fs.writeFileSync(
    path.join(localBranchPath, 'manifest.json'),
    JSON.stringify(localManifest, null, 2)
  );

  checkout(branch);

  return `Applied ${newCommits.length} commits.`;
}

/**
 * Uploads local commits via the two-step /push and /commit/part flow.
 * @returns {Promise<string>} Success message.
 */

async function push () {
  /**
   * Load local state and prepare for server-side manifest comparison.
   */

  const artifactPath = path.join(process.cwd(), '.art');
  const artifactJson = JSON.parse(
    fs.readFileSync(path.join(artifactPath, 'art.json'), 'utf8')
  );

  if (!artifactJson.remote) {
    throw new Error('Remote URL not configured.');
  }

  const branch = artifactJson.active.branch;
  const token = artifactJson.configuration.personalAccessToken;
  const remoteParts = artifactJson.remote.split('/');
  const repo = remoteParts.pop();
  const handle = remoteParts.pop();
  const localBranchPath = path.join(artifactPath, 'history/local', branch);
  const remoteBranchPath = path.join(artifactPath, 'history/remote', branch);
  const localManifest = JSON.parse(
    fs.readFileSync(path.join(localBranchPath, 'manifest.json'), 'utf8')
  );

  /**
   * Identify local commits that do not yet exist on the remote server.
   */

  const response = await fetch(
    `${ARTIFACT_HOST}/manifest`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'history',
        handle,
        repo,
        branch,

        ...(token && { personalAccessToken: token })
      })
    }
  );

  const remoteManifest = await response.json();
  const missingCommits = [];

  for (const hash of localManifest.commits) {
    if (!remoteManifest.commits.includes(hash)) {
      missingCommits.push(hash);
    }
  }

  if (missingCommits.length === 0) {
    return 'Everything up to date.';
  }

  /**
   * If the remote repository is empty, prepare the initial root data for upload.
   */

  let rootData = null;

  if (remoteManifest.commits.length === 0) {
    const rootMasterPath = path.join(artifactPath, 'root/manifest.json');

    if (fs.existsSync(rootMasterPath)) {
      const master = JSON.parse(
        fs.readFileSync(rootMasterPath, 'utf8')
      );

      const parts = {};

      for (const partName of master.parts) {
        parts[partName] = JSON.parse(
          fs.readFileSync(path.join(artifactPath, 'root', partName), 'utf8')
        );
      }

      rootData = { master, parts };
    }
  }

  const currentRemoteManifestPath = path.join(remoteBranchPath, 'manifest.json');

  const currentRemoteManifest = fs.existsSync(currentRemoteManifestPath)
    ? JSON.parse(fs.readFileSync(currentRemoteManifestPath, 'utf8'))
    : { commits: [] };

  /**
   * Perform sequential uploads for each missing commit
   * and its associated file parts.
   */

  for (const commitHash of missingCommits) {
    const commitMaster = JSON.parse(
      fs.readFileSync(path.join(localBranchPath, `${commitHash}.json`), 'utf8')
    );

    const pushRes = await fetch(
      `${ARTIFACT_HOST}/push`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle, repo, branch, commit: commitMaster,
          ...(rootData && { root: rootData }),
          ...(token && { personalAccessToken: token })
        })
      }
    );

    if (!pushRes.ok) {
      throw new Error(`Push rejected (commit: ${commitHash}).`);
    }

    rootData = null;

    for (const partName of commitMaster.parts) {
      const partData = JSON.parse(
        fs.readFileSync(path.join(localBranchPath, partName), 'utf8')
      );

      const partRes = await fetch(
        `${ARTIFACT_HOST}/commit/part`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle, repo, branch, partName, partData,
            ...(token && { personalAccessToken: token })
          })
        }
      );

      if (!partRes.ok) {
        throw new Error(`Push rejected (file part: ${partName}).`);
      }
    }

    /**
     * Update the remote-tracking manifest local cache.
     */

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
