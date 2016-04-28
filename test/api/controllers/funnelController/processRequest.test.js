var
  should = require('should'),
  q = require('q'),
  sinon = require('sinon'),
  RequestObject = require.main.require('lib/api/core/models/requestObject'),
  ResponseObject = require.main.require('lib/api/core/models/responseObject'),
  params = require('rc')('kuzzle'),
  Kuzzle = require.main.require('lib/api/Kuzzle'),
  Profile = require.main.require('lib/api/core/models/security/profile'),
  Token = require.main.require('lib/api/core/models/security/token'),
  Role = require.main.require('lib/api/core/models/security/role'),
  User = require.main.require('lib/api/core/models/security/user'),
  rewire = require('rewire'),
  FunnelController = rewire('../../../../lib/api/controllers/funnelController');

require('sinon-as-promised')(q.Promise);

describe('funnelController.processRequest', function () {
  var
    context = {
      connection: {id: 'connectionid'},
      token: null
    },
    kuzzle,
    processRequest = FunnelController.__get__('processRequest'),
    stubs = {
      verifyToken: () => {
        var token = new Token();
        token._id = undefined;
        token.user = {
          _id: -1,
          profile: {
            _id: 'anonymous',
            isActionAllowed: () => q(false)
          }
        };
        return q(token);
      }
    };

  before(() => {
    kuzzle = new Kuzzle();

    return kuzzle.start(params, {dummy: true});
  });

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    sandbox.stub(kuzzle.repositories.token, 'verifyToken').resolves({
      user: {
        _id: -1,
        profile: {
          _id: 'anonymous',
          isActionAllowed: () => q(true)
        }
      }
    });
    sandbox.stub(kuzzle.funnel.controllers.read, 'serverInfo').resolves(new ResponseObject({}));
   });

  afterEach(() => {
    sandbox.restore();
  });

  it('should reject the promise if no controller is specified', () => {
    var requestObject = new RequestObject({action: 'create'});
    return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 400});
  });

  it('should reject the promise if no action is specified', () => {
    var requestObject = new RequestObject({controller: 'write'});
    return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 400});
  });

  it('should reject the promise if the controller doesn\'t exist', () => {
    var requestObject = new RequestObject({
      controller: 'toto',
      action: 'create'
    });
    return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 400});
  });

  it('should reject the promise if the action doesn\'t exist', () => {
    var requestObject = new RequestObject({
      controller: 'write',
      action: 'toto'
    });
    return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 400});
  });

  it('should reject the promise if the user is not allowed to execute the action', () => {
    var
      token = new Token(),
      user = new User(),
      requestObject = new RequestObject({
        controller: 'read',
        action: 'serverInfo'
      });

    kuzzle.repositories.token.verifyToken.restore();
    sandbox.stub(kuzzle.repositories.token, 'verifyToken').resolves({
      user: {
        _id: -1,
        profile: {
          _id: 'anonymous',
          isActionAllowed: () => q(false)
        }
      }
    });

    return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 401})
    .then(() => {
      kuzzle.repositories.token.verifyToken.restore();
      sandbox.stub(kuzzle.repositories.token, 'verifyToken').resolves({
        _id: 'fake-token',
        user: {
          _id: 'fake-user',
          profile: {
            _id: 'guest',
            isActionAllowed: () => q(false)
          }
        }
      });
      return should(processRequest(kuzzle, kuzzle.funnel.controllers, requestObject, context)).be.rejectedWith(ResponseObject, {status: 403});
    });

  });

  it('should resolve the promise if everything is ok', () => {
    var requestObject = new RequestObject({
      requestId: 'requestId',
      controller: 'read',
      action: 'serverInfo'
    });

    return should(processRequest(kuzzle, kuzzle.funnel.controllers,requestObject, context)).not.be.rejected();
  });

  it('should resolve the promise in case of a plugin controller action', () => {
    var
      pluginController = {
        bar: requestObject => q()
      },
      requestObject = new RequestObject({
        requestId: 'requestId',
        controller: 'myplugin/foo',
        action: 'bar',
        name: 'John Doe'
      });

    // Reinitialize the Funnel controller with the dummy plugin controller:
    sandbox.stub(kuzzle.funnel, 'controllers', {'myplugin/foo': pluginController});

    return should(processRequest(kuzzle, kuzzle.funnel.controllers,requestObject, context)).not.be.rejected();
  });
});
