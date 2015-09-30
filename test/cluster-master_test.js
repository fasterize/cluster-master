var clusterMaster = require('../cluster-master.js'),
    sinon = require('sinon'),
    assert = require('assert');

describe('ClusterMaster', function() {

  describe('Worker actions', function() {
    var worker;
    beforeEach(function(){
      worker = {
        process:  {disconnect: sinon.spy()},
        disconnect: sinon.spy()
      }
    });

    it("should disconnect worker when suicide not defined", function(){
      clusterMaster.disconnectWorker(worker);

      assert(worker.disconnect.calledOnce)
      assert(!worker.process.disconnect.calledOnce)
      assert(worker.willBeDead)
    });

    it("should disconnect worker when suicide is true", function(){
      worker.suicide = true;
      clusterMaster.disconnectWorker(worker);

      assert(worker.process.disconnect.calledOnce)
      assert(!worker.disconnect.calledOnce)
      assert(worker.willBeDead)
    });
  });

  describe('handleWorkerCondemnedToBeDead', function() {
    var workers;
    beforeEach(function(){
      workers = {
        '1': {
          process: { disconnect: sinon.spy() },
          disconnect: sinon.spy()
        },
        '2': {
          process: { disconnect: sinon.spy() },
          disconnect: sinon.spy()
        },
        '3': {
          process: { disconnect: sinon.spy() },
          disconnect: sinon.spy()
        }
      }
    });

    it("should disconnect worker tagged with the flag willBeDead", function(){
      workers['1'].willBeDead = true;
      clusterMaster.handleWorkerCondemnedToBeDead(workers);

      assert(workers['1'].process.disconnect.calledOnce)
      assert(!workers['2'].process.disconnect.calledOnce)
      assert(!workers['3'].process.disconnect.calledOnce)

      assert(!workers['1'].disconnect.calledOnce)
      assert(!workers['2'].disconnect.calledOnce)
      assert(!workers['3'].disconnect.calledOnce)
    });

    it("should tag suicide worker with willBeDead", function(){
      workers['1'].suicide = true;
      clusterMaster.handleWorkerCondemnedToBeDead(workers);

      assert(workers['1'].willBeDead)

      assert(!workers['1'].process.disconnect.calledOnce)
      assert(!workers['2'].process.disconnect.calledOnce)
      assert(!workers['3'].process.disconnect.calledOnce)

      assert(!workers['1'].disconnect.calledOnce)
      assert(!workers['2'].disconnect.calledOnce)
      assert(!workers['3'].disconnect.calledOnce)
    });

  });
});
