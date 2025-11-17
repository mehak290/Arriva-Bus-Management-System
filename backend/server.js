// server.js (Complete Unified Backend)

const express = require('express');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { PubSub } = require('graphql-subscriptions');
const { WebSocketServer } = require('ws'); 
const { useServer } = require('graphql-ws'); 
const { createServer } = require('http'); 
const cors = require('cors');
const jsonServer = require('json-server'); 
const path = require('path');

// 🛑 FIX for "fetch is not a function" error: 
// Assign the imported node-fetch library to the global fetch variable.
// This is necessary because your Node.js version doesn't provide a global fetch by default.
const fetch = require('node-fetch'); 
if (typeof global.fetch === 'undefined') {
  global.fetch = fetch;
}

const pubsub = new PubSub();
const BUS_LOC_TOPIC = 'BUS_LOCATION';

// Port configuration: Apollo on 4001, JSON Server on 9001
const JSON_SERVER_PORT = 9002; 
const GRAPHQL_HTTP_PORT = 4001; // Updated to 4001 as per your confirmation
const GRAPHQL_PATH = '/graphql';

// --- SCHEMA DEFINITION (typeDefs) ---
const typeDefs = `
  type Coordinates { lat: Float, lng: Float }
  type Bus { id: ID!, number: String!, route: String!, capacity: Int, coords: Coordinates }
  type Review { id: ID!, name: String!, message: String!, timestamp: Float }
  
  type Query {
    buses: [Bus]
    reviews: [Review]
  }
  
  type Mutation {
    addBus(number: String!, route: String!, capacity: Int): Bus
    updateBusLocation(id: ID!, lat: Float!, lng: Float!): Bus
    addReview(name: String!, message: String!): Review
  }
  
  type Subscription {
    busLocationUpdated: Bus
  }
`;

// In-memory data store for buses (Subscriptions)
let buses = [
  { id: '1', number: 'MH12AB1234', route: 'A-B', capacity: 40, coords: { lat: 19.07, lng: 72.87 } }
];

// --- RESOLVERS (Data Logic) ---
const resolvers = {
  Query: {
    buses: () => buses,
    reviews: async () => {
        // Fetch reviews from the internal JSON Server on port 9001
        const response = await fetch(`http://localhost:${JSON_SERVER_PORT}/reviews`);
        return response.json();
    },
  },
  Mutation: {
    addBus: (_, { number, route, capacity }) => {
      const bus = { id: String(buses.length + 1), number, route, capacity, coords: { lat: 0, lng: 0 } };
      buses.push(bus);
      return bus;
    },
    updateBusLocation: (_, { id, lat, lng }) => {
      const bus = buses.find(b => b.id === String(id));
      if (!bus) return null;
      bus.coords.lat = lat;
      bus.coords.lng = lng;
      pubsub.publish(BUS_LOC_TOPIC, { busLocationUpdated: bus });
      return bus;
    },
    addReview: async (_, { name, message }) => {
        const newReview = { name, message, timestamp: Date.now() };
        // Post review to the internal JSON Server on port 9001
        // This is where fetch() was failing
        const response = await fetch(`http://localhost:${JSON_SERVER_PORT}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newReview),
        });
        
        if (response.status !== 201 && response.status !== 200) {
            console.error(`JSON Server POST failed with status: ${response.status}`);
            // Throw an error so the frontend knows something went wrong
            throw new Error(`Backend failed to save data. Status: ${response.status}`);
        }
        
        return response.json();
    }
  },
  Subscription: {
    busLocationUpdated: {
      subscribe: () => pubsub.asyncIterator(BUS_LOC_TOPIC),
    },
  },
};

// --- STARTUP FUNCTION ---
async function start() {
  
  // 1. START JSON SERVER (for Login/Signup and Data Persistence)
  const jsonRouter = jsonServer.router(path.join(__dirname, 'db.json'));
  const jsonMiddlewares = jsonServer.defaults();
  const jsonServerApp = express();
  jsonServerApp.use(jsonMiddlewares);
  jsonServerApp.use(jsonServer.bodyParser); 
  jsonServerApp.use(jsonRouter);

  jsonServerApp.listen(JSON_SERVER_PORT, () => {
      console.log(`JSON Server running internally on ${JSON_SERVER_PORT} for REST/Data`);
  });


  // 2. START GRAPHQL & WEBSOCKET SERVER
  const app = express();
  const httpServer = createServer(app);

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const apolloServer = new ApolloServer({ schema });
  await apolloServer.start();
  
  // Apply GraphQL HTTP middleware (Queries/Mutations)
  app.use(
    GRAPHQL_PATH,
    cors(),
    express.json(),
    expressMiddleware(apolloServer),
  );

  // REST endpoint for simulating location updates
  app.post('/simulate-location', (req, res) => {
    const { id } = req.body;
    const bus = buses.find(b => b.id === String(id));
    if (!bus) return res.status(404).json({ error: 'bus not found' });
    
    // Mutate coords slightly
    bus.coords.lat += (Math.random() - 0.5) * 0.001;
    bus.coords.lng += (Math.random() - 0.5) * 0.001;
    
    pubsub.publish(BUS_LOC_TOPIC, { busLocationUpdated: bus });
    return res.json(bus);
  });

  // Setup WebSocket Server for Subscriptions
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: GRAPHQL_PATH,
  });

  useServer({ schema }, wsServer);

  // Start the combined HTTP and WebSocket server
  httpServer.listen(GRAPHQL_HTTP_PORT, () => {
    console.log(`HTTP/GraphQL server running at http://localhost:${GRAPHQL_HTTP_PORT}${GRAPHQL_PATH}`);
    console.log(`WebSocket/Subscription server ready at ws://localhost:${GRAPHQL_HTTP_PORT}${GRAPHQL_PATH}`);
  });
}

start();
