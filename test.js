class test {
	constructor(req) {
		// this.req = req;
	}

	met(app){
		this.app = app;
		// console.log(req)
	}
	show(){
		this.app.budi = 878787;
		return this.app;
	}
}

export default new test;