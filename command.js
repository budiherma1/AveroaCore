import { Command } from 'commander';
import fs from 'fs'

const program = new Command();

const command = () => {

	program
	  .name('averoa')
	  .description('CLI for averoajs')
	  .version('0.1.0');
	
	program.command('make:controller')
	  .description('create controller')
	  .argument('<string>', 'controller name')
	  .action((str, options) => {
		let template = `class ${str} {
		async sampleMethod(req, res) {
			res.send('hello world');
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Controllers/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
		  });
	  });
	
	program.command('make:middleware')
	  .description('create middleware')
	  .argument('<string>', 'middleware name')
	  .action((str, options) => {
		let template = `class ${str} {
		async handle(req, res) {
			res.send('hello world');
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Middleware/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
		  });
	  });
	
	program.command('make:model')
	  .description('create model')
	  .argument('<string>', 'model name')
	  .action((str, options) => {
		let template = `import { Model } from 'objection';
	
	class ${str} extends Model {
	  static tableName = '${str.toLowerCase()}';
	}
	
	export default ${str};`;
		fs.writeFile(`app/Models/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
			let stream = fs.createWriteStream(`app/Models/index.js`, {flags:'a'});
			stream.write("\n" + `export { default as ${str} } from './${str}.js'`);
		  });
	  });
	
	program.command('make:helper')
	  .description('create helper')
	  .argument('<string>', 'helper name')
	  .action((str, options) => {
		let template = `class ${str} {
		async sampleMethod(req, res) {
	
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Helpers/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
			let stream = fs.createWriteStream(`app/Helpers/index.js`, {flags:'a'});
			stream.write("\n" + `export { default as ${str} } from './${str}.js'`);
		  });
	  });
	
	program.command('make:job')
	  .description('create job')
	  .argument('<string>', 'job name')
	  .action((str, options) => {
		let template = `class ${str} {
		async sampleMethod(req, res) {
	
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Jobs/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
			let stream = fs.createWriteStream(`app/Jobs/index.js`, {flags:'a'});
			stream.write("\n" + `export { default as ${str} } from './${str}.js'`);
		  });
	  });
	
	program.command('make:repository')
	  .description('create repository')
	  .argument('<string>', 'repository name')
	  .action((str, options) => {
		let template = `class ${str} {
		async sampleMethod(req, res) {
	
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Repositories/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
			let stream = fs.createWriteStream(`app/Repositories/index.js`, {flags:'a'});
			stream.write("\n" + `export { default as ${str} } from './${str}.js'`);
		  });
	  });
	
	program.command('make:strategy')
	  .description('create strategy')
	  .argument('<string>', 'strategy name')
	  .action((str, options) => {
		let template = `class ${str} {
		async config() {
	
		}
	
		async authenticate(req, res, next) {
	
		}
	}
	
	export default new ${str};`;
		fs.writeFile(`app/Strategies/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(`${str} is created successfully.`);
			let stream = fs.createWriteStream(`app/Strategies/index.js`, {flags:'a'});
			stream.write("\n" + `export { default as ${str} } from './${str}.js'`);
		  });
	  });
	
	program.parse();
}

export default command;