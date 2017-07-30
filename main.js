'use strict'
const http = require( 'http' )
const ws = require('ws')
const compose = require( 'koa-compose' )
const WebSocket = ws.Server

class Socket {
	/**
	 * OK
	 * 
	 * @param  socket     [description]
	 * @param  listeners  [description]
	 * @param  middleware [description]
	 * @param   clientId   [description]
	 */
	constructor(socket, listeners, middleware, clientId){
		this.socket = socket
		this.middleware = null
		this.clientId = clientId

		this.update(listeners, middleware)
	}

	on(event, handler){
		let that = this
		this.socket.on(event, (data, cb) => {
			let packet = {
				event: event,
				data: data,
				socket: that,
				acknowledge: cb
			}
			if(!that.middleware) {
				handler(packet, data)
				return
			}

			that.middleware( packet ).then( () => {
				handler( packet, data )
			})
		})
	}

	update( listeners, middleware ){
		// this.socket.removeAllListeners()
		this.middleware = middleware

		listeners.forEach( (handler, event) => {
			if (event === 'connection'){
				return
			}

			handler.forEach( handler => {
				this.on( event, handler)
			})
		})
	}

	get id(){
		return this.clientId
	}

	send(msg){
		console.log(msg, 'send')
		this.socket.send(msg)
	}

	disconnect(){
		this.socket.close()
	}
}

module.exports = class IO{
	constructor(){
		let that = this
		this.middleware = []
		this.composed = null
		this.listeners = new Map()
		this.connections = new Map()
		this.cliendId = 0;
		this.onConnect = this.onConnect.bind(this)
		this.onDisconnect = this.onDisconnect.bind(this)

		const interval = setInterval(()=>{
			that.connections.forEach(connection => {
				if(connection.socket.isAlive == false) return connection.socket.terminate()
				connection.socket.isAlive = false;
			console.log('send ping')
				connection.socket.ping('', false, true)
			})
		}, 30000)
	}
	attach(app){
		if(app.server && app.server.constructor.name != 'Server') {
			throw new Error('app.server already exists but it\'s not an http server');
		}
		if(!app.server) {
			app.server = http.createServer(app.callback());
			app.listen = function listen(){
				app.server.listen.apply( app.server, arguments )
				return app.server
			}
		}

		app._io = new WebSocket({server: app.server})
		app.io = this
		this.socket = app._io
		this.socket.on('connection', this.onConnect.bind(this))
	}
	// it's ok
	use(fn) {
		this.middleware.push(fn)
		this.composed = compose(this.middleware)
		this.updateConnections()
		return this
	}
	on( event, handler) {
		let listeners = this.listeners.get(event)

		if(!listeners){
			this.listeners.set(event, [handler])
			this.updateConnections()
			return this
		}

		listeners.push(handler)
		this.listeners.set( event, listeners )
		this.updateConnections()
		return this
	}
	broadcast( event, data){ // it's ok
		this.connections.forEach( (socket) => {
			socket.send(data);
		})
	}
	onConnect(socket){
		let that = this;
		let instance = new Socket(socket, this.listeners, this.composed, this.cliendId)
		instance.socket.isAlive = true
		this.connections.set(this.cliendId, instance)
		// 断开连接
		socket.on('close', () => {
			this.onDisconnect(this.cliendId)
		})

		socket.on('pong', ()=>{
			console.log('pong')
			instance.socket.isAlive = true;
		})

		let handlers = this.listeners.get('connection')
		if(handlers){
			handlers.forEach( handler => {
				instance.socket.send('welcome men')
				handler({
					event: 'connection',
					data: instance,
					socket: instance.socket
				}, instance.id)
			})
		}


		this.cliendId++
	}
	onDisconnect(cliendId){
		this.connections.delete(cliendId)
	}
	updateConnections(){
		this.connections.forEach( connection => {
			connection.update( this.listeners, this.composed)
		})
	}
}