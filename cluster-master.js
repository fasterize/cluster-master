// Set up a cluster and set up resizing and such.

const cluster = require('cluster');

const _ = require('underscore');

let quitting = false;
let restarting = false;
let tooQuick = false;
const path = require('path');

let clusterSize = 0;
let env;
const os = require('os');

let onmessage;
const repl = require('repl');

let replAddressPath = process.env.CLUSTER_MASTER_REPL || 'cluster-master-socket';
const net = require('net');
const fs = require('fs');
const util = require('util');

let minRestartAge = 10000;
let maxUnstableRestarts = 5;
let unstableRestarts = 0;
let listeningWorkers = true;
let danger = false;
let cleanCondemnedWorkersInterval = 60000;
const tooQuickTimeOut = 30000;
const forcefullyKillTimeOut = 5000;
let logger;

exports = clusterMaster;
module.exports = clusterMaster;
exports.restart = restart;
exports.disconnectWorker = disconnectWorker;
exports.handleCleaningOfCondemnedWorkers = handleCleaningOfCondemnedWorkers;
exports.resize = resize;
exports.quitHard = quitHard;
exports.quit = quit;

const debugStreams = {};

let resizing = false;
const resizeCbs = [];

function debug(...args) {
  if (logger) {
    logger.debug(...args);
  } else {
    console.error(...args);
  }

  const msg = util.format(...args);
  Object.keys(debugStreams).forEach(stream => {
    try {
      // if the write fails, just remove it.
      debugStreams[stream].write(`${msg}\n`);
      if (debugStreams[stream].repl) debugStreams[stream].repl.displayPrompt();
    } catch (_e) {
      delete debugStreams[stream];
    }
  });
}

function clusterMaster(config) {
  if (typeof config === 'string') config = { exec: config };

  if (config.logger) ({ logger } = config);

  if (config.cleanComdemnedWorkersInterval) {
    // zero is not allowed.
    cleanCondemnedWorkersInterval = config.cleanComdemnedWorkersInterval;
  }

  if (!config.exec) {
    throw new Error("Must define a 'exec' script");
  }

  if (!cluster.isMaster) {
    throw new Error("ClusterMaster answers to no one!\n(don't run in a cluster worker script)");
  }

  if (cluster._clusterMaster) {
    throw new Error('This cluster has a master already');
  }

  cluster._clusterMaster = module.exports;

  if (typeof config.repl !== 'undefined') replAddressPath = config.repl; // allow null and false

  onmessage = config.onMessage || config.onmessage;

  clusterSize = config.size || os.cpus().length;

  minRestartAge = config.minRestartAge || minRestartAge;

  if (config.listeningWorkers !== undefined) {
    ({ listeningWorkers } = config);
  }

  if (config.maxUnstableRestarts) ({ maxUnstableRestarts } = config);

  maxUnstableRestarts *= clusterSize;

  ({ env } = config);

  const masterConf = { exec: path.resolve(config.exec) };
  if (config.silent) masterConf.silent = true;
  if (config.env) masterConf.env = config.env;
  if (config.args) masterConf.args = config.args;

  cluster.setupMaster(masterConf);

  if (config.signals !== false) {
    // sighup/sigint listeners
    setupSignals();
  }

  forkListener();

  // now make it the right size
  debug(replAddressPath ? 'resize and then setup repl' : 'resize');
  resize(setupRepl);

  // start worker killer handler
  setInterval(() => {
    handleCleaningOfCondemnedWorkers(cluster.workers);
  }, cleanCondemnedWorkersInterval);
}

function select(field) {
  return Object.keys(cluster.workers)
    .map(key => [key, cluster.workers[key][field]])
    .reduce((set, kv) => {
      let _0;
      [_0, set[kv[0]]] = kv;
      return set;
    }, {});
}

function setupRepl() {
  if (!replAddressPath) return; // was disabled

  debug('setup repl');
  let socket = null;
  let socketAddress;
  if (typeof replAddressPath === 'string') {
    socket = path.resolve(replAddressPath);
  } else if (typeof replAddressPath === 'number') {
    socket = replAddressPath;
    if (!Number.isNaN(socket)) socket = +socket;
  } else if (replAddressPath.address && replAddressPath.port) {
    socket = replAddressPath.port;
    socketAddress = replAddressPath.address;
  }
  let connections = 0;

  if (typeof socket === 'string') {
    fs.unlink(socket, er => {
      if (er && er.code !== 'ENOENT') throw er;
      startRepl();
    });
  } else {
    startRepl();
  }

  function startRepl() {
    debug(`starting repl on ${socket}=`);
    process.on('exit', () => {
      try {
        fs.unlinkSync(socket);
      } catch (er) {
        /* */
      }
    });
    let sockId = 0;
    const replServer = net.createServer(sock => {
      connections++;
      let replEnded = false;

      sock.id = sockId++;
      debugStreams[`repl-${sockId}`] = sock;

      sock.write(`Starting repl #${sock.id}`);
      const myRepl = repl.start({
        prompt: `ClusterMaster (\`help\` for cmds) ${process.pid} ${sock.id}> `,
        input: sock,
        output: sock,
        terminal: true,
        useGlobal: false,
        ignoreUndefined: true,
      });

      const helpCommands = [
        'help        - display these commands',
        'repl        - access the REPL',
        'resize(n)   - resize the cluster to `n` workers',
        'restart(cb) - gracefully restart workers, cb is optional',
        'stop()      - gracefully stop workers and master',
        'kill()      - forcefully kill workers and master',
        'cluster     - node.js cluster module',
        'size        - current cluster size',
        'connections - number of REPL connections to master',
        'workers     - current workers',
        'select(fld) - map of id to field (from workers)',
        'pids        - map of id to pids',
        'ages        - map of id to worker ages',
        'states      - map of id to worker states',
        'debug(a1)   - output `a1` to stdout and all REPLs',
        'sock        - this REPL socket',
        '.exit       - close this connection to the REPL',
      ];

      const context = {
        help: helpCommands,
        repl: myRepl,
        resize,
        restart,
        stop: quit,
        kill: quitHard,
        cluster,
        get size() {
          return clusterSize;
        },
        get connections() {
          return connections;
        },
        get workers() {
          const pid = select('pid');
          const state = select('state');
          const age = select('age');
          return Object.keys(cluster.workers).map(
            key => new Worker({ id: key, pid: pid[key], state: state[key], age: age[key] })
          );
        },
        select,
        get pids() {
          return select('pid');
        },
        get ages() {
          return select('age');
        },
        get states() {
          return select('state');
        },
        // like 'wall'
        debug,
        sock,
      };
      const desc = Object.getOwnPropertyNames(context)
        .map(prop => [prop, Object.getOwnPropertyDescriptor(context, prop)])
        .reduce((set, kv) => {
          let _0;
          [_0, set[kv[0]]] = kv;
          return set;
        }, {});
      Object.defineProperties(myRepl.context, desc);

      sock.repl = myRepl;

      let ended = false;

      myRepl.on('end', () => {
        connections--;
        replEnded = true;
        if (!ended) sock.end();
      });

      sock.on('end', end);
      sock.on('close', end);
      sock.on('error', end);

      function end() {
        if (ended) return;
        ended = true;
        if (!replEnded) myRepl.rli.close();
        delete debugStreams[`repl-${sockId}`];
      }
    });

    if (socketAddress) {
      replServer.listen(socket, socketAddress, () => {
        debug(`ClusterMaster repl listening on ${socketAddress}:${socket}`);
      });
    } else {
      replServer.listen(socket, () => {
        debug(`ClusterMaster repl listening on ${socket}`);
      });
    }
  }
}

function Worker(worker) {
  this.id = worker.id;
  this.pid = worker.pid;
  this.state = worker.state;
  this.age = worker.age;
}

Worker.prototype.disconnect = function() {
  cluster.workers[this.id].disconnect();
};

Worker.prototype.kill = function() {
  process.kill(this.pid);
};

function endOfUnstableRestarts() {
  const workersIds = Object.keys(cluster.workers);
  if (workersIds.length === clusterSize && !resizing) {
    let stillUnstable = false;
    workersIds.forEach(id => {
      if (cluster.workers[id].age < 20000) {
        stillUnstable = true;
      }
    });

    if (!stillUnstable) {
      debug('end of the unstable restarts');
      unstableRestarts = 0;
    } else {
      setTimeout(endOfUnstableRestarts, 10000);
    }
  }
}

function forkListener() {
  cluster.on('fork', worker => {
    worker.birth = Date.now();
    Object.defineProperty(worker, 'age', {
      get() {
        return Date.now() - this.birth;
      },
      enumerable: true,
      configurable: true,
    });
    worker.pid = worker.process.pid;
    const { id } = worker;
    debug('Worker %j setting up', id);
    if (onmessage) worker.on('message', onmessage);
    let disconnectTimer;

    worker.on('exit', () => {
      clearTimeout(disconnectTimer);

      if (!worker.exitedAfterDisconnect) {
        debug('Worker %j exited abnormally', id);
        if (unstableRestarts === maxUnstableRestarts) {
          debug('too many unstable restarts. Stopped.');
          process.exit(1);
        }
        // don't respawn right away if it's a very fast failure.
        // otherwise server crashes are hard to detect from monitors.
        if (worker.age < minRestartAge) {
          unstableRestarts++;
          setTimeout(endOfUnstableRestarts, 60000);
          debug('Worker %j died too quickly, danger', id);
          danger = true;
          // still try again in a few seconds, though.
          resizing = false;
          setTimeout(resize, 2000);
          return;
        }
      } else {
        debug('Worker %j exited', id);
      }

      if (Object.keys(cluster.workers).length < clusterSize && !resizing) {
        resize();
      }
    });

    worker.on('disconnect', () => {
      debug('Worker %j disconnect', id);
      // give it 1 second to shut down gracefully, or kill
      disconnectTimer = setTimeout(() => {
        debug('Worker %j, forcefully killing', id);
        worker.process.kill('SIGKILL');
      }, forcefullyKillTimeOut);
    });
  });
}

function shouldWorkerBeCondemned(worker) {
  return worker.exitedAfterDisconnect || !worker.process.connected;
}

function condemnedWorker(worker) {
  if (!worker.condemnationDate) {
    debug('Worker %j, condemned to death', worker.id);
    worker.condemnationDate = Date.now();
  }
}

function shouldWorkerBeKill(worker) {
  return worker.condemnationDate && Date.now() - worker.condemnationDate > forcefullyKillTimeOut;
}

function killWorker(worker) {
  debug('Worker %j, roughly killing', worker.id);
  process.kill(worker.process.pid, 'SIGKILL');
}

function disconnectWorker(worker) {
  condemnedWorker(worker);
  if (!worker.exitedAfterDisconnect) {
    debug('Worker %j, disconnecting', worker.id);
    worker.disconnect();
  }
}

function handleCleaningOfCondemnedWorkers(workers) {
  if (restarting) {
    return;
  }

  Object.keys(workers).forEach(id => {
    const worker = workers[id];

    if (shouldWorkerBeKill(worker)) {
      killWorker(worker);
    } else if (shouldWorkerBeCondemned(worker)) {
      // It will be roughly kill the next time this method is call.
      condemnedWorker(worker);
    }
  });
}

function restart(cb) {
  if (restarting || tooQuick) {
    debug('Already restarting or too quick restart.  Cannot restart yet.');
    return;
  }

  // cleanUp before restarting
  handleCleaningOfCondemnedWorkers(cluster.workers);

  restarting = true;
  // prevent too quick reload (30s)
  tooQuick = true;
  setTimeout(() => {
    tooQuick = false;
  }, tooQuickTimeOut);

  // graceful restart.
  // all the existing workers get killed, and this
  // causes new ones to be spawned.  If there aren't
  // already the intended number, then fork new extras.
  // Apply restart only on worker that are not tagged with willBeDead
  // this will prevent the growth in size when restart is fired
  const current = _.filter(Object.keys(cluster.workers), workerId => !cluster.workers[workerId].willBeDead);

  let { length } = current;
  const reqs = clusterSize - length;

  let i = 0;

  // if we're resizing, then just kill off a few.
  if (reqs !== 0) {
    debug('resize %d -> %d, change = %d', current.length, clusterSize, reqs);

    resize(clusterSize, () => {
      debug('resize cb');
      length = clusterSize;
      graceful();
    });

    return;
  }

  // all the current workers, kill and then wait for a
  // new one to spawn before moving on.
  graceful();
  function graceful() {
    debug('graceful %d of %d', i, length);
    if (i >= current.length) {
      debug('graceful completion');
      restarting = false;
      return cb && typeof cb === 'function' && cb();
    }

    const first = i === 0;
    const id = current[i++];
    const worker = cluster.workers[id];

    if (quitting) {
      if (worker && worker.process.connected) {
        disconnectWorker(worker);
      }
      return graceful();
    }

    function skepticRestart(newbie) {
      const timer = setTimeout(() => {
        newbie.removeListener('exit', skeptic);
        if (worker && worker.process.connected) {
          disconnectWorker(worker);
        }
        graceful();
      }, 2000);
      newbie.on('exit', skeptic);
      function skeptic() {
        debug('New worker died quickly. Aborting restart.');
        restarting = false;
        clearTimeout(timer);
      }
    }

    function classicRestart(_newbie) {
      if (worker && worker.process.connected) {
        disconnectWorker(worker);
      }
    }

    // start a new one. if it lives for 2 seconds, kill the worker.
    if (first) {
      if (listeningWorkers) {
        cluster.once('listening', skepticRestart);
      } else {
        cluster.once('fork', skepticRestart);
      }
    } else {
      if (listeningWorkers) {
        cluster.once('listening', classicRestart);
      } else {
        cluster.once('fork', classicRestart);
      }
      graceful();
    }

    cluster.fork(env);
    return undefined;
  }
}

function resize(size, callback) {
  if (typeof size === 'function') {
    callback = size;
    size = clusterSize;
  }

  if (callback) resizeCbs.push(callback);

  if (resizing) {
    debug('Already resizing. Cannot resize yet.');
    return;
  }

  resizing = true;

  function cb() {
    debug('done resizing');

    resizing = false;
    const callbacks = resizeCbs.slice(0);
    resizeCbs.length = 0;
    callbacks.forEach(currentCallback => {
      currentCallback();
    });
    if (clusterSize !== Object.keys(cluster.workers).length) {
      if (danger && clusterSize === 0) {
        debug('DANGER! something bad has happened');
        process.exit(1);
      } else {
        danger = true;
        debug('DANGER! wrong number of workers');
        setTimeout(resize, 1000);
      }
    } else {
      danger = false;
    }
  }

  if (size >= 0) clusterSize = size;
  const current = Object.keys(cluster.workers);
  const nbWorkers = current.length;
  let req = clusterSize - nbWorkers;

  // avoid angry "listening" listeners
  cluster.setMaxListeners(clusterSize * 2);

  if (nbWorkers === clusterSize) {
    resizing = false;
    cb();
    return;
  }

  let thenCnt = 0;
  function then() {
    thenCnt++;
    return then2;
  }
  function then2() {
    if (--thenCnt === 0) {
      resizing = false;
      return cb();
    }
    return undefined;
  }

  // make us have the right number of them.
  if (req > 0)
    while (req-- > 0) {
      debug('resizing up', req);
      if (listeningWorkers) {
        cluster.once('listening', then());
      } else {
        cluster.once('fork', then());
      }

      cluster.fork(env);
    }
  else
    for (let i = clusterSize; i < nbWorkers; i++) {
      const worker = cluster.workers[current[i]];
      debug('resizing down', current[i]);
      worker.once('exit', then());
      if (worker && worker.process.connected) {
        disconnectWorker(worker);
      }
    }
}

function quitHard() {
  quitting = true;
  quit();
}

function quit() {
  if (quitting) {
    debug('Forceful shutdown');
    // last ditch effort to force-kill all workers.
    Object.keys(cluster.workers).forEach(id => {
      const worker = cluster.workers[id];
      if (worker && worker.process) worker.process.kill('SIGKILL');
    });
    process.exit(1);
  }

  debug('Graceful shutdown...');
  clusterSize = 0;
  quitting = true;
  restart(() => {
    debug('Graceful shutdown successful');
    process.exit(0);
  });
}

function setupSignals() {
  try {
    process.on('SIGHUP', restart);
    process.on('SIGINT', quit);
  } catch (_e) {
    // Must be on Windows, waaa-waaah.
  }

  process.on('exit', () => {
    if (!quitting) quitHard();
  });
}
