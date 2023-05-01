import { Command } from 'commander';
import fs from 'fs'
import chalk from 'chalk';
import edge from './edge-js.js';
import path from 'path';
const __dirname = path.resolve();
const program = new Command();

edge.mount(path.join(__dirname, '/node_modules/@averoa/core/template'))

const command = async () => {

	program
		.name('averoa')
		.description('CLI for averoajs')
		.version('0.1.0');

	// Controller
	program.command('make:controller')
		.description('create controller')
		.argument('<string>', 'controller name')
		.action(async (str, options) => {

			let template = await edge.render('controller', { controller: str })

			fs.writeFile(`app/Controllers/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
			});
		});

	// Middleware
	program.command('make:middleware')
		.description('create middleware')
		.argument('<string>', 'middleware name')
		.action(async (str, options) => {
			let template = await edge.render('middleware', { middleware: str })
			fs.writeFile(`app/Middleware/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
			});
		});

	// Model
	program.command('make:model')
		.description('create model')
		.argument('<string>', 'model name')
		.action(async (str, options) => {
			let template = await edge.render('model', { model: str.toLowerCase() })
			fs.writeFile(`app/Models/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
				let stream = fs.createWriteStream(`app/Models/index.js`, { flags: 'a' });
				stream.write(`export { default as ${str} } from './${str}.js';` + "\n");

			});
		});

	// CRUD
	program.command('make:crud')
		.description('create set of crud')
		.argument('<string>', 'list of DB name separated by comma, example: users,rooms,user_categories')
		.option('-init', 'running it for the first time')
		.action(async (stri, options) => {
			let splitStr = stri.split(',');
			let tRoute = [];

			for (let i in splitStr) {
				let vstr = splitStr[i];
				let str = titleCase(vstr);
				tRoute.push({ model: str, path: vstr.split('_').join('-') })
			}

			for (let i in splitStr) {
				let vstr = splitStr[i];
				let str = titleCase(vstr);
				let time = Number(new Date().getTime()) + i

				let strContoller = str + 'Controller';
				let template = await edge.render('crud-model', { model: str, db: vstr })
				await fs.writeFile(`app/Models/${str}.js`, template, async function (err) {
					if (err) throw err;
					console.log(chalk.green(`${str} is created successfully.`));
					let stream = await fs.createWriteStream(`app/Models/index.js`, { flags: 'a' });
					await stream.write(`export { default as ${str} } from './${str}.js';` + "\n");

					// migration
					let migration = await edge.render('crud-migration', { migration: str })

					let migrationName = `${time}_${str}`;
					await fs.writeFile(`database/migrations/${migrationName}.js`, migration, function (err) {
						if (err) throw err;
						console.log(chalk.green(`${migrationName} is created successfully.`));
					});

					// seed
					let seed = await edge.render('crud-seed', { seed: str })
					let seedName = `${time}_${str}`;
					await fs.writeFile(`database/seeds/${seedName}.js`, seed, function (err) {
						if (err) throw err;
						console.log(chalk.green(`${seedName} is created successfully.`));
					});

					// controller
					let templateC = await edge.render('crud-controller', { controller: strContoller, model: str })
					await fs.writeFile(`app/Controllers/${strContoller}.js`, templateC, function (err) {
						if (err) throw err;
						console.log(chalk.green(`${strContoller} is created successfully.`));
					});

				});
			}

			if (options.init || options.Init) {

				// router
				let templateR = await edge.render('crud-router', { data: tRoute })
				await fs.writeFile(`routes/api.js`, templateR, function (err) {
					if (err) throw err;
					console.log(chalk.green(`routes are created successfully.`));
				});
			} else {
				fs.readFile('routes/api.js', 'utf8', async (err, data) => {
					if (err) {
						return console.log(err);
					}

					let templateR = await edge.render('crud-router-additional', { data: tRoute })
					const result = data.replace('export default router;', templateR);

					fs.writeFile('routes/api.js', result, 'utf8', (err) => {
						if (err) return console.log(err);
					});
				});
			}


		});

	// Helper
	program.command('make:helper')
		.description('create helper')
		.argument('<string>', 'helper name')
		.action(async (str, options) => {
			let template = await edge.render('helper', { name: str })
			fs.writeFile(`app/Helpers/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
				let stream = fs.createWriteStream(`app/Helpers/index.js`, { flags: 'a' });
				stream.write(`export { default as ${str} } from './${str}.js';` + "\n");
			});
		});

	// Job
	program.command('make:job')
		.description('create job')
		.argument('<string>', 'job name')
		.action(async (str, options) => {
			let template = await edge.render('job', { name: str })
			fs.writeFile(`app/Jobs/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
				let stream = fs.createWriteStream(`app/Jobs/index.js`, { flags: 'a' });
				stream.write(`export { default as ${str} } from './${str}.js';` + "\n");
			});
		});

	// Repository
	program.command('make:repository')
		.description('create repository')
		.argument('<string>', 'repository name')
		.action(async (str, options) => {
			let template = await edge.render('repository', { name: str })
			fs.writeFile(`app/Repositories/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
				let stream = fs.createWriteStream(`app/Repositories/index.js`, { flags: 'a' });
				stream.write(`export { default as ${str} } from './${str}.js';` + "\n");
			});
		});

	// Strategy
	program.command('make:strategy')
		.description('create strategy')
		.argument('<string>', 'strategy name')
		.action(async (str, options) => {
			let template = await edge.render('strategy', { name: str })
			fs.writeFile(`app/Strategies/${str}.js`, template, function (err) {
				if (err) throw err;
				console.log(chalk.green(`${str} is created successfully.`));
				let stream = fs.createWriteStream(`app/Strategies/index.js`, { flags: 'a' });
				stream.write(`export { default as ${str} } from './${str}.js';` + "\n");
			});
		});

	program.parse();
}

function titleCase(str) {
	return str.toLowerCase().split('_').map(function (word) {
		return (word.charAt(0).toUpperCase() + word.slice(1));
	}).join('');
}

export default command;