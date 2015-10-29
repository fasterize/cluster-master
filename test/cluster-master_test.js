var clusterMaster = require('../cluster-master'),
    sinon = require('sinon'),
    should = require('should');

describe('ClusterMaster', function() {

  describe('#disconnectWorker', function() {
    var worker;

    beforeEach(function() {
      worker = {
        suicide: undefined,
        disconnect: sinon.spy(),
        process: { connected: true }
      };
    });

    it('should condemned and disconnect worker if suicide is false', function() {
      clusterMaster.disconnectWorker(worker);

      should.exist(worker.condemnationDate);
      worker.disconnect.calledOnce.should.be.true;
    });

    it('should condemned but not disconnect worker if suicide is true', function(){
      worker.suicide = true;
      clusterMaster.disconnectWorker(worker);

      should.exist(worker.condemnationDate);
      worker.disconnect.called.should.be.false;
    });

    it('should not condemned worker multiple times', function() {
      clusterMaster.disconnectWorker(worker);
      var expectedDate = worker.condemnationDate;
      clusterMaster.disconnectWorker(worker);

      worker.condemnationDate.should.be.equal(expectedDate);
    });
  });

  describe('#handleCleaningOfCondemnedWorkers', function() {
    var workers;

    beforeEach(function() {
      sinon.stub(process, 'kill');

      workers = {
        '1': {
          suicide: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 1 }
        },
        '2': {
          suicide: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 2 }
        },
        '3': {
          suicide: undefined,
          disconnect: sinon.spy(),
          process: { connected: true, pid: 3 }
        }
      };
    });

    afterEach(function() {
      process.kill.restore();
    });

    it("should kill condemned worker if forcefullyKillTimeOut is elapsed", function(){
      var worker = workers['2'],
          forcefullyKillTimeOut = 5000;

      worker.condemnationDate = Date.now() - forcefullyKillTimeOut;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      process.kill.calledOnce.should.be.true;
      process.kill.calledWith(worker.process.pid).should.be.true;
    });

    it("should not kill condemned worker if forcefullyKillTimeOut is not elapsed", function(){
      var worker = workers['2'];

      worker.condemnationDate = Date.now();
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      process.kill.called.should.be.false;
    });

    it("should condemned worker if suicide is true", function(){
      var worker = workers['3'];

      worker.suicide = true;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.exist(worker.condemnationDate);
      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
    });

    it("should condemned worker if it is not connected", function(){
      var worker = workers['3'];

      worker.process.connected = false;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.exist(worker.condemnationDate);
      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
    });

    it("should not condemned connected and non suicidal worker", function(){
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      should.not.exist(workers['1'].condemnationDate);
      should.not.exist(workers['2'].condemnationDate);
      should.not.exist(workers['3'].condemnationDate);
    });

    it('should not condemned worker multiple times', function() {
      var worker = workers['3'];

      worker.process.connected = false;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);
      var expectedDate = worker.condemnationDate;
      clusterMaster.handleCleaningOfCondemnedWorkers(workers);

      worker.condemnationDate.should.be.equal(expectedDate);
    });
  });
});
