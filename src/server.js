'use strict';

require('dotenv').config();

const Hapi = require('@hapi/hapi');
const ClientError = require('./errors/ClientError');
const Jwt = require('@hapi/jwt');
const Inert = require('@hapi/inert');
const path = require('path');

/* --------------------------------- plugins -------------------------------- */
// songs
const songs = require('./api/songs');
const SongsService = require('./services/postgres/SongsService');
const SongsValidator = require('./validator/songs');
// users
const users = require('./api/users');
const UsersService = require('./services/postgres/UsersService');
const UsersValidator = require('./validator/users');
// authentications
const authentications = require('./api/authentications');
const AuthenticationsService = require(
    './services/postgres/AuthenticationsService',
);
const TokenManager = require('./tokenize/TokenManager');
const AuthenticationsValidator = require('./validator/authentications');
// playlists
const playlists = require('./api/playlists');
const PlaylistsService = require('./services/postgres/PlaylistsService');
const PlaylistsValidator = require('./validator/playlists');
// collaborations
const collaborations = require('./api/collaborations');
const CollaborationsService = require(
    './services/postgres/CollaborationsService',
);
const CollaborationsValidator = require('./validator/collaborations');
// exports
const _exports = require('./api/exports');
const ProducerService = require('./services/rabbitmq/ProducerService');
const ExportsValidator = require('./validator/exports');
// uploads
const uploads = require('./api/uploads');
const StorageService = require('./services/storage/StorageService');
const UploadsValidator = require('./validator/uploads');
// cache
const CacheService = require('./services/redis/CacheService');

const init = async () => {
  const cacheService = new CacheService();
  const collaborationsService = new CollaborationsService();
  const songsService = new SongsService();
  const usersService = new UsersService();
  const authenticationsService = new AuthenticationsService();
  const playlistsService = new PlaylistsService(
      collaborationsService,
      cacheService,
  );
  const storageService = new StorageService(
      path.resolve(__dirname, 'api/uploads/file/images'),
  );

  const server = Hapi.server({
    port: process.env.PORT,
    host: process.env.HOST,
    routes: {
      cors: {
        origin: ['*'],
      },
    },
  });

  // registrasi plugin eksternal
  await server.register([
    {
      plugin: Jwt,
    },
    {
      plugin: Inert,
    },
  ]);

  // mendefinisikan strategy autentikasi Jwt
  server.auth.strategy('openmusic_jwt', 'jwt', {
    keys: process.env.ACCESS_TOKEN_KEY,
    verify: {
      aud: false,
      iss: false,
      sub: false,
      maxAgeSec: process.env.ACCESS_TOKEN_AGE,
    },
    validate: (artifacts) => ({
      isValid: true,
      credentials: {
        id: artifacts.decoded.payload.id,
      },
    }),
  });

  await server.register([
    {
      plugin: songs,
      options: {
        service: songsService,
        validator: SongsValidator,
      },
    },
    {
      plugin: users,
      options: {
        service: usersService,
        validator: UsersValidator,
      },
    },
    {
      plugin: authentications,
      options: {
        authenticationsService,
        usersService,
        tokenManager: TokenManager,
        validator: AuthenticationsValidator,
      },
    },
    {
      plugin: playlists,
      options: {
        playlistsService,
        songsService,
        validator: PlaylistsValidator,
      },
    },
    {
      plugin: collaborations,
      options: {
        collaborationsService,
        playlistsService,
        validator: CollaborationsValidator,
      },
    },
    {
      plugin: _exports,
      options: {
        producerService: ProducerService,
        playlistsService,
        validator: ExportsValidator,
      },
    },
    {
      plugin: uploads,
      options: {
        service: storageService,
        validator: UploadsValidator,
      },
    },
  ]);

  server.ext('onPreResponse', (request, h) => {
    // mendapatkan konteks response dari request
    const {response} = request;

    if (response instanceof ClientError) {
      /**
       * membuat response baru dari response toolkit sesuai kebutuhan error
       * handling
       */
      const newResponse = h.response({
        status: 'fail',
        message: response.message,
      });
      newResponse.code(response.statusCode);
      return newResponse;
    } else if (response instanceof Error) { // SERVER ERROR
      const {output: {statusCode}} = response;
      const errorMessage = (statusCode && statusCode == 401) ?
        'Silakan login untuk mendapatkan akses ke resource ini' :
        undefined;

      const newResponse = h.response({
        status: 'error',
        message: (errorMessage) ?
        errorMessage :
        'Maaf terjadi masalah pada server kami',
      });
      newResponse.code(
        (statusCode) ? response.output.statusCode : 500,
      );
      console.error(response); // tampilkan log error server
      return newResponse;
    }

    /**
     * jika bukan ClientError, lanjutkan dengan response sebelumnya (tanpa
     * terintervensi)
     */
    return response.continue || response;
  });

  await server.start();
  console.log('Server berjalan pada %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

init();
