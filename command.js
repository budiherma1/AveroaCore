import { Command } from 'commander';
import fs from 'fs'
import chalk from 'chalk';

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
			console.log(chalk.green(`${str} is created successfully.`));
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
			console.log(chalk.green(`${str} is created successfully.`));
		  });
	  });
	
	program.command('make:model')
	  .description('create model')
	  .argument('<string>', 'model name')
	  .option('-m', 'create migration also')
	  .option('-s', 'create seed also')
	  .action((str, options) => {
		let template = `import { Model } from '@averoa/models';';

class ${str} extends Model {
  static tableName = '${str.toLowerCase()}';

  static timestamp = true;

  static column = {
	id: {
	  migration: (m) => m.table.increments(m.column).primary(),
	  method: { post: false },
	  validation: [{ run: (v) => v.validator.isEmail(v.value), msg: 'email format required' }],
	},
	sample_column: {
	  migration: (m) => m.table.string(m.column, 50).nullable(),
	  seed: (f) => f.name.firstName(),
	  method: { get: true, post: true },
	  validation: [{ run: (v) => v.validator.isEmail(v.value), msg: 'email format required' }],
	},
  };
}

export default ${str};`;
		fs.writeFile(`app/Models/${str}.js`, template, function (err) {
			if (err) throw err;
			console.log(chalk.green(`${str} is created successfully.`));
			let stream = fs.createWriteStream(`app/Models/index.js`, {flags:'a'});
			stream.write(`export { default as ${str} } from './${str}.js';`+ "\n" );

			if (options.m) {

				// migration
				let migration = `import { ${str} } from '@averoa/models';
	
	export const up = ${str}.migrationUp.bind(${str});
	export const down = ${str}.migrationDown.bind(${str});
	`
	
				let migrationName = `${new Date().getTime()}_${str}`;
				fs.writeFile(`database/migrations/${migrationName}.js`, migration, function (err) {
					if (err) throw err;
					console.log(chalk.green(`${migrationName} is created successfully.`));
				  });
			}

			if (options.s) {

				// seed
				let seed = `import { ${str} } from '@averoa/models';
	
	export const seed = ${str}.seeder.bind(${str}, 10);
	`
				let seedName = `${str}Seed`;
				fs.writeFile(`database/seeds/${seedName}.js`, seed, function (err) {
					if (err) throw err;
					console.log(chalk.green(`${seedName} is created successfully.`));
				  });
			}

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
			console.log(chalk.green(`${str} is created successfully.`));
			let stream = fs.createWriteStream(`app/Helpers/index.js`, {flags:'a'});
			stream.write(`export { default as ${str} } from './${str}.js';`+ "\n" );
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
			console.log(chalk.green(`${str} is created successfully.`));
			let stream = fs.createWriteStream(`app/Jobs/index.js`, {flags:'a'});
			stream.write(`export { default as ${str} } from './${str}.js';`+ "\n" );
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
			console.log(chalk.green(`${str} is created successfully.`));
			let stream = fs.createWriteStream(`app/Repositories/index.js`, {flags:'a'});
			stream.write(`export { default as ${str} } from './${str}.js';`+ "\n" );
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
			console.log(chalk.green(`${str} is created successfully.`));
			let stream = fs.createWriteStream(`app/Strategies/index.js`, {flags:'a'});
			stream.write(`export { default as ${str} } from './${str}.js';`+ "\n" );
		  });
	  });
	
	program.parse();
}

export default command;