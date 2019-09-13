const _should = require('should');
const cluster = require('cluster');
const clusterMaster = require('../cluster-master');

if (cluster.isWorker) {
  const http = require('http');

  http
    .createServer((req, res) => {
      res.writeHead(200);
      res.end('hello world\n');
    })
    .listen(8000);
} else {
  describe('ClusterMaster#resize', () => {
    let nbWorkers = 2;
    before(() => {
      clusterMaster({
        exec: __filename,
        size: nbWorkers,
      });
    });

    after(() => {
      clusterMaster.quit();
    });

    it('should start two workers', () => {
      Object.keys(cluster.workers).length.should.equal(nbWorkers);
    });

    it('should resize to 4', () => {
      nbWorkers = 4;
      clusterMaster.resize(nbWorkers);
      Object.keys(cluster.workers).length.should.equal(nbWorkers);
    });

    it('should restart a killed worker', done => {
      const pids = Object.keys(cluster.workers).map(id => cluster.workers[id].pid);
      Object.values(cluster.workers)[0].kill();
      setTimeout(() => {
        Object.keys(cluster.workers).length.should.equal(nbWorkers);
        Object.keys(cluster.workers)
          .map(id => cluster.workers[id].pid)
          .filter(pid => pids.indexOf(pid) < 0)
          .length.should.equal(1);
        done();
      }, 500);
    });

    it('should resize to 1', () => {
      nbWorkers = 1;
      clusterMaster.resize(nbWorkers);
      Object.keys(cluster.workers).length.should.equal(nbWorkers);
    });
  });
}
