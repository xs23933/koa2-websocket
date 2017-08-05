'use strict'
const http = require( 'http' )
const ws = require('ws')
const compose = require( 'koa-compose' )
const WebSocket = ws.Server

class Sock {
	constructor(sock, listeners, middleware, clientId){
		this.sock = sock
		this.middleware = null
		this.clientId = clientId

		this.update(listeners, middleware)
	}

	on(event, handler){
		let packet
		var that = this
		this.sock.on('message', (data, cb) => {
			try{
				data = JSON.parse(data)
				if (event != data.cmd){
					return
				}
				data.data = data.data || ''
				packet = {
					event: data.cmd,
					data: data.data,
					sock: that,
					acknowledge: cb  // next
				}

				if ( !this.middleware ) {
					handler( packet, data )
					return
				}

				this.middleware( packet ).then( () => {
					handler( packet, data )
				})
			}catch(e){}
		})
	}

	update( listeners, middleware ){
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

	send(pkg){
		switch(typeof pkg){
			case "object":
				pkg = JSON.stringify(pkg)
				break;
			case "string":
				break;
		}
		this.sock.send(pkg)
	}

	disconnect(){
		this.sock.close()
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
				if(connection.sock.isAlive == false) return connection.sock.terminate()
				connection.sock.isAlive = false;
				connection.sock.ping('', false, true)
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
		this.websock = app._io
		this.websock.on('connection', this.onConnect.bind(this))
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
	broadcast( cmd, data){ // it's ok
		this.connections.forEach( (instance) => {
			try{
				instance.send({ cmd: cmd, data: data })
			}catch(e){}
		})
	}
	onConnect(sock){
		let that = this;
		let instance = new Sock(sock, this.listeners, this.composed, this.cliendId)
		instance.sock.isAlive = true
		this.connections.set(this.cliendId, instance)
		// 断开连接
		sock.on('close', () => {
			this.onDisconnect(this.cliendId)
		})

		sock.on('pong', ()=>{
			instance.sock.isAlive = true;
		})

		let handlers = this.listeners.get('connection')
		if(handlers){
			handlers.forEach( handler => {
				handler({
					event: 'connection',
					data: instance,
					sock: instance.sock
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