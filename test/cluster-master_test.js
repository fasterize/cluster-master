const sinon = require('sinon');
const should = require('should');
const clusterMaster = require('../cluster-master');

describe('ClusterMaster', () => {
  describe('#disconnectWorker', () => {
    let worker;

    beforeEach(() => {
      worker = {
        exitedAfterDisconnect: undefined,
        disconnect: sinon.spy(),
        process: { connected: true },
      };
    });

    it('should condemned and disconnect worker if exitedAfterDisconnect is false', () => {
      clusterMaster.disconnectWorker(worker);

      should.exist(worker.condemnationDate);
      worker.disconnect.calledOnce.should.be.true;
    });

    it('should condemned but not disconnect worker if exitedAfterDisconnect is true', () => {
      worker.exitedAfterDisconnect = true;
      clusterMaster.disconnectWorker(worker);

      should.exist(worker.condemnationDate);
      worker.disconnect.called.should.be.false;
    });

    it('should not condemned worker multiple times', () => {
      clusterMaster.disconnectWorker(worker);
      const expectedDate = worker.condemnationDate;
      clusterMaster.disconnectWorker(worker);

      worker.condemnationDate.should.be.equal(expectedDate);
    });
  });

  describe('#handleCleaningOfCondemnedWorkers', () => {
    let workers;

    beforeEach(() => {
      sinon.stub(process, 'kill');

      workers = {
        '1': {
          exitedAfterDisconnect: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 1 },
        },
        '2': {
          exitedAfterDisconnect: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 2 },
        },
        '3': {
          exitedAfterDisconnect: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 3 },
        },
      };
    });

    afterEach(() => {
      process.kill.restore();
    });

    it('should kill condemned worker if forcefullyKillTimeOut is elapsed', () => {
      const worker = workers['2'];
      const forcefullyKillTimeOut = 5000;

      worker.condemnationDate = Date.now() - forcefullyKillTimeOut;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      process.kill.calledOnce.should.be.true;
      process.kill.calledWith(worker.process.pid).should.be.true;
    });

    it('should not kill condemned worker if forcefullyKillTimeOut is not elapsed', () => {
      const worker = workers['2'];

      worker.condemnationDate = Date.now();
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      process.kill.called.should.be.false;
    });

    it('should condemned worker if exitedAfterDisconnect is true', () => {
      const worker = workers['3'];

      worker.exitedAfterDisconnect = true;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.exist(worker.condemnationDate);
      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
    });

    it('should condemned worker if it is not connected', () => {
      const worker = workers['3'];

      worker.process.connected = false;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.exist(worker.condemnationDate);
      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
    });

    it('should not condemned connected and non suicidal worker', () => {
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
      should.not.exist(workers['3'].condemnationDate);
    });

    it('should not condemned worker multiple times', () => {
      const worker = workers['3'];

      worker.process.connected = false;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);
      const expectedDate = worker.condemnationDate;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      worker.condemnationDate.should.be.equal(expectedDate);
    });
  });
});
