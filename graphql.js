import {ApolloServer}  from 'apollo-server-express';
import {ApolloServerPluginDrainHttpServer} from 'apollo-server-core';
import http from 'http';

async function startApolloServer(typeDefs, resolvers, app) {
	const httpServer = http.createServer(app);
	const server = new ApolloServer({
	  typeDefs,
	  resolvers,
	  csrfPrevention: true,
	  cache: 'bounded',
	  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
	});
  
	await server.start();
	server.applyMiddleware({ app });
	await new Promise(resolve => httpServer.listen({ port: 4000 }, resolve));
	console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
  }

export default startApolloServer;