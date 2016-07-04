var
  _ = require('lodash'),
  describe = require('ava-spec').describe,
  q = require('q'),
  sinon = require('sinon'),
  params = require('rc')('kuzzle'),
  should = require('should'),
  Role = require.main.require('../../../lib/api/core/models/security/role'),
  Profile = require.main.require('../../../lib/api/core/models/security/profile'),
  BadRequestError = require.main.require('kuzzle-common-objects').Errors.badRequestError,
  ForbiddenError = require.main.require('kuzzle-common-objects').Errors.forbiddenError,
  InternalError = require.main.require('kuzzle-common-objects').Errors.internalError,
  NotFoundError = require.main.require('kuzzle-common-objects').Errors.notFoundError,
  RequestObject = require.main.require('kuzzle-common-objects').Models.requestObject,
  Kuzzle = require.main.require('../../../lib/api/Kuzzle');

require('sinon-as-promised')(q.Promise);

describe('Test: repositories/profileRepository', test => {
  var
    testProfile,
    testProfile2,
    testProfilePlain = {
      _id: 'testprofile',
      roles: [
        {_id: 'test', restrictedTo: [{index: 'index'}]},
        {_id: 'test2'}
      ]
    },
    errorProfilePlain = {
      _id: 'errorprofile',
      roles: [ 'error' ]
    },
    stubs = {
      profileRepository:{
        loadFromCache: (id) => {
          if (id !== 'testprofile-cached') {
            return q(null);
          }
          return q(testProfile);
        }
      },
      roleRepository:{
        loadRoles: (keys) => {
          return q(keys
            .map((key) => {
              var role = new Role();
              role._id = key;
              return role;
            })
          );
        }
      }
    };

  test.before(t => {
    testProfile = new Profile();
    testProfile._id = 'testprofile';
    testProfile.roles = [];
    testProfile.roles[0] = new Role();
    testProfile.roles[0]._id = 'test';
    testProfile.roles[0].restrictedTo = [{index: 'index'}];
    testProfile.roles[1] = new Role();
    testProfile.roles[1]._id = 'test2';

    testProfile2 = new Profile();
    testProfile2._id = 'testprofile2';
    testProfile2.roles = ['test2'];
  });

  test.beforeEach(t => {
    t.context.kuzzle = new Kuzzle();
    return t.context.kuzzle.start(params, {dummy: true})
    .then(() => {
      t.context.sandbox = sinon.sandbox.create();
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'loadFromCache', stubs.profileRepository.loadFromCache);
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'persistToCache').resolves({});
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'deleteFromCache').resolves({});
    });
  });

  test.afterEach(t => {
    t.context.sandbox.restore();
  });

  test.describe('#loadProfile', it => {
    it('should return null if the profile does not exist', t => {
      t.context.sandbox.stub(t.context.kuzzle.services.list.readEngine, 'get').rejects(new NotFoundError('Not found'));
      return t.context.kuzzle.repositories.profile.loadProfile('idontexist')
        .then(result => should(result).be.null());
    });

    it('should reject the promise in case of error', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'loadOneFromDatabase').rejects(new InternalError('Error'));
      return should(t.context.kuzzle.repositories.profile.loadProfile('id')).be.rejectedWith(InternalError);
    });

    it('should load a profile from cache if present', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'refreshCacheTTL').resolves({});

      return t.context.kuzzle.repositories.profile.loadProfile('testprofile-cached')
        .then(result => {
          should(result).be.an.instanceOf(Profile);
          should(result).be.eql(testProfile);
        });
    });

    it('should load a profile from the db', t => {
      t.context.sandbox.stub(t.context.kuzzle.services.list.readEngine, 'get').resolves(testProfilePlain);
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);
      return t.context.kuzzle.repositories.profile.loadProfile('testprofile')
        .then(result => {
          should(result).be.an.instanceOf(Profile);
          should(result).be.eql(testProfile);
        });
    });
  });

  test.describe('#buildProfileFromRequestObject', it => {
    it('should reject when no id is provided', t => {
      var invalidProfileObject = new RequestObject({
        body: {
          _id: ''
        }
      });


      return should(t.context.kuzzle.repositories.profile.buildProfileFromRequestObject(invalidProfileObject))
         .be.rejectedWith(BadRequestError);
    });

    it('should resolve to a valid Profile when a valid object is provided', t => {
      var validProfileObject = new RequestObject({
        body: testProfilePlain
      });

      return should(t.context.kuzzle.repositories.profile.buildProfileFromRequestObject(validProfileObject))
         .be.fulfilledWith(testProfilePlain);
    });
  });

  test.describe('#hydrate', it => {
    it('should reject the promise in case of error', t => {
      t.context.sandbox.stub(t.context.kuzzle.services.list.readEngine, 'get').resolves(errorProfilePlain);
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles').rejects(new InternalError('Error'));
      return should(t.context.kuzzle.repositories.profile.loadProfile('errorprofile')).be.rejectedWith(InternalError);
    });

    it('should hydrate a profille with its roles', t => {
      var p = new Profile();

      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);
      return t.context.kuzzle.repositories.profile.hydrate(p, testProfilePlain)
        .then(result => {
          should(result.roles[0]).be.an.instanceOf(Role);
          should(result.roles[0]._id).be.equal('test');
          should(result.roles[0].restrictedTo).match([{index: 'index'}]);
        });
    });

    it('should throw if the profile contains unexisting roles', t => {
      var p = new Profile();
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles').resolves([]);
      return should(t.context.kuzzle.repositories.profile.hydrate(p, { roles: [{_id: 'notExistingRole' }] })).be.rejectedWith(NotFoundError);
    });
  });

  test.describe('#deleteProfile', it => {
    it('should reject when no id is provided', t => {
      var invalidProfileObject = new RequestObject({
        body: {
          _id: ''
        }
      });


      return should(t.context.kuzzle.repositories.profile.deleteProfile(invalidProfileObject))
          .be.rejectedWith(BadRequestError);
    });

    it('should reject if a user uses the profile about to be deleted', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'profiles', {
        'test': {
          _id: 'test',
          roles: ['test']
        }
      });

      t.context.sandbox.stub(t.context.kuzzle.repositories.user.readEngine, 'search').resolves({total: 1, hits: ['test']});

      return should(t.context.kuzzle.repositories.profile.deleteProfile({_id: 'test'})).rejectedWith(ForbiddenError);
    });

    it('should return a raw delete response after deleting', t => {
      var response = {_id: 'testprofile'};

      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'deleteFromDatabase').resolves(response);
      t.context.sandbox.stub(t.context.kuzzle.repositories.user, 'search').resolves({total: 0});

      return should(t.context.kuzzle.repositories.profile.deleteProfile(testProfile))
          .be.fulfilledWith(response);
    });

    it('should reject when trying to delete admin', t => {
      var profile = {
        _id: 'admin',
        roles: [ {_id: 'admin'} ]
      };

      return should(t.context.kuzzle.repositories.profile.deleteProfile(profile))
          .be.rejectedWith(BadRequestError);
    });

    it('should reject when trying to delete default', t => {
      var profile = {
        _id: 'default',
        roles: [ {_id: 'default'} ]
      };


      return should(t.context.kuzzle.repositories.profile.deleteProfile(profile))
          .be.rejectedWith(BadRequestError);
    });

    it('should reject when trying to delete anonymous', t => {
      var profile = {
        _id: 'anonymous',
        roles: [ {_id: 'anonymous'} ]
      };

      return should(t.context.kuzzle.repositories.profile.deleteProfile(profile))
          .be.rejectedWith(BadRequestError);
    });
  });

  test.describe('#serializeToDatabase', it => {
    it('should return a plain flat object', t => {
      t.context.sandbox.stub(t.context.kuzzle.services.list.readEngine, 'get').resolves(testProfilePlain);
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);
      return t.context.kuzzle.repositories.profile.loadProfile('testprofile')
        .then(function (profile) {
          var result = t.context.kuzzle.repositories.profile.serializeToDatabase(profile);

          should(result).not.be.an.instanceOf(Profile);
          should(result).be.an.Object();
          should(profile._id).be.exactly('testprofile');
          should(result.roles).be.an.Array();
          should(result.roles).have.length(2);
          should(result.roles[0]).be.an.Object();
          should(result.roles[0]).not.be.an.instanceOf(Role);
          should(result.roles[0]._id).be.exactly('test');
          should(result.roles[0].restrictedTo).be.an.Array();
          should(result.roles[1]).be.an.Object();
          should(result.roles[1]).not.be.an.instanceOf(Role);
          should(result.roles[1]._id).be.exactly('test2');
          should(result.roles[1].restrictedTo).be.empty();
        });
    });
  });

  test.describe('#searchProfiles', it => {
    it('should return a ResponseObject containing an array of profiles', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'search').resolves({
        hits: [{_id: 'test'}],
        total: 1
      });

      return t.context.kuzzle.repositories.profile.searchProfiles([])
        .then(result => {
          should(result).be.an.Object();
          should(result).have.property('hits');
          should(result).have.property('total');
          should(result.hits).be.an.Array();
          should(result.hits[0]).be.an.Object();
          should(result.hits[0]._id).be.exactly('test');
        });
    });

    it('should properly format the roles filter', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'search', (filter) => {
        return q({
          hits: [{_id: 'test'}],
          total: 1,
          filter: filter
        });
      });

      return t.context.kuzzle.repositories.profile.searchProfiles(['role1'])
        .then(result => {
          should(result.filter).have.ownProperty('or');
          should(result.filter.or).be.an.Array();
          should(result.filter.or[0]).have.ownProperty('terms');
          should(result.filter.or[0].terms).have.ownProperty('roles._id');
          should(result.filter.or[0].terms['roles._id']).be.an.Array();
          should(result.filter.or[0].terms['roles._id'][0]).be.exactly('role1');
        });
    });
  });

  test.describe('#validateAndSaveProfile', it => {
    it('should reject when no id is provided', t => {
      var invalidProfile = new Profile();
      invalidProfile._id = '';


      return should(t.context.kuzzle.repositories.profile.validateAndSaveProfile(invalidProfile))
          .be.rejectedWith(BadRequestError);
    });

    it('should properly persist the profile', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'persistToDatabase', profile => q({_id: profile._id}));
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);

      return t.context.kuzzle.repositories.profile.validateAndSaveProfile(testProfile)
        .then((result) => {
          should(t.context.kuzzle.repositories.profile.profiles[testProfile._id]).match({roles: [{_id: 'test'}]});
          should(result).be.an.Object();
          should(result._id).be.eql(testProfile._id);
        });
    });

    it('should properly persist the profile with a non object role', t => {
      t.context.sandbox.stub(t.context.kuzzle.repositories.profile, 'persistToDatabase', profile => q({_id: profile._id}));
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);

      return t.context.kuzzle.repositories.profile.validateAndSaveProfile(testProfile2)
        .then((result) => {
          should(t.context.kuzzle.repositories.profile.profiles[testProfile2._id]).match({roles: [{_id: 'test2'}]});
          should(result).be.an.Object();
          should(result._id).be.eql(testProfile2._id);
        });
    });
  });

  test.describe('#defaultRole', it => {
    it('should add the default role when the profile do not have any role set', t => {
      var profile = new Profile();

      profile._id = 'NoRole';
      t.context.sandbox.stub(t.context.kuzzle.repositories.role, 'loadRoles', stubs.roleRepository.loadRoles);

      return t.context.kuzzle.repositories.profile.hydrate(profile, {})
        .then(result => should(result.roles[0]._id).be.eql('default'));
    });
  });
});
