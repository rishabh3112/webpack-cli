import * as Generator from "yeoman-generator";

import * as glob from "glob-all";
import * as autoComplete from "inquirer-autocomplete-prompt";
import * as path from "path";

import npmExists from "@webpack-cli/utils/npm-exists";
import { getPackageManager } from "@webpack-cli/utils/package-manager";
import PROP_TYPES from "@webpack-cli/utils/prop-types";
import { AutoComplete, Confirm, Input, List } from "@webpack-cli/webpack-scaffold";

import { SchemaProperties, WebpackOptions, SchemaProperty } from "./types";
import entryQuestions from "./utils/entry";
import { generatePluginName } from "./utils/plugins";
import * as webpackDevServerSchema from "webpack-dev-server/lib/options.json";
import * as webpackSchema from "./utils/optionsSchema.json";
const PROPS: string[] = Array.from(PROP_TYPES.keys());

/**
 *
 * Checks if the given array has a given property
 *
 * @param	{Array} arr - array to check
 * @param	{String} prop - property to check existence of
 *
 * @returns	{Boolean} hasProp - Boolean indicating if the property
 * is present
 */
const traverseAndGetProperties = (arr: object[], prop: string): boolean => {
	let hasProp = false;
	arr.forEach(
		(p: object): void => {
			if (p[prop]) {
				hasProp = true;
			}
		}
	);
	return hasProp;
};

/**
 *
 * Search config properties
 *
 * @param {Object} answers	Prompt answers object
 * @param {String} input	Input search string
 *
 * @returns {Promise} Returns promise which resolves to filtered props
 *
 */
const searchProps = (answers: object, input: string): Promise<string[]> => {
	input = input || "";
	return Promise.resolve(PROPS.filter((prop: string): boolean => prop.toLowerCase().includes(input.toLowerCase())));
};

/**
 *
 * Generator for adding properties
 * @class	AddGenerator
 * @extends	Generator
 * @returns	{Void} After execution, transforms are triggered
 *
 */

export default class AddGenerator extends Generator {
	private dependencies: string[];
	private configuration: {
		config: {
			configName?: string;
			topScope?: string[];
			item?: string;
			webpackOptions?: WebpackOptions;
		};
	};

	public constructor(args, opts) {
		super(args, opts);
		this.dependencies = [];
		this.configuration = {
			config: {
				topScope: ["const webpack = require('webpack')"],
				webpackOptions: {}
			}
		};
		const { registerPrompt } = this.env.adapter.promptModule;
		registerPrompt("autocomplete", autoComplete);
	}

	public async prompting(): Promise<void> {
		let action: string;
		const self: this = this;
		const manualOrListInput: (promptAction: string) => Generator.Question = (
			promptAction: string
		): Generator.Question => Input("actionAnswer", `What do you want to add to ${promptAction}?`);
		let inputPrompt: Generator.Question;

		// first index indicates if it has a deep prop, 2nd indicates what kind of
		// TODO: this must be reviewed. It starts as an array of booleans but after that it get overridden
		// Bye bye functional programming.
		// eslint-disable-next-line
		const isDeepProp: any[] = [false, false];

		const actionTypeAnswer: Generator.Answers =  await this.prompt([
			AutoComplete(
				"actionType",
				"What property do you want to add to?",
				{
					pageSize: 7,
					source: searchProps,
					suggestOnly: false,
				},
			),
		]);

		// Set initial prop, like devtool
		this.configuration.config.webpackOptions[
			actionTypeAnswer.actionType
		] = null;
		// update the action variable, we're using it later
		action = actionTypeAnswer.actionType;

		if (action === "entry") {
			const entryTypeAnswer: Generator.Answers = await this.prompt([
				Confirm("entryType", "Will your application have multiple bundles?", false),
			]);

			// Ask different questions for entry points
			const entryOptions = await entryQuestions(self, entryTypeAnswer.entryType);

			this.configuration.config.webpackOptions.entry = entryOptions;
			this.configuration.config.item = action;

		} else {
			if (action === "topScope") {

				const topScopeAnswer: Generator.Answers = await this.prompt([
					Input("topScope", "What do you want to add to topScope?"),
				]);

				this.configuration.config.topScope.push(topScopeAnswer.topScope);
				return;
			}
		}

		// Storing action's name that user selected as Schema might have it with other name
		const originalAction: string = action;
		if (action === "resolveLoader") {
			action = "resolve";
		}
		const webpackSchemaProp: SchemaProperties = webpackSchema.definitions[action];
		/*
		* https://github.com/webpack/webpack/blob/next/schemas/WebpackOptions.json
		* Find the properties directly in the properties prop, or the anyOf prop
		*/
		let defOrPropDescription: object = webpackSchemaProp
			? webpackSchemaProp.properties
			: webpackSchema.properties[action].properties
				? webpackSchema.properties[action].properties
				: webpackSchema.properties[action].anyOf
					? webpackSchema.properties[action].anyOf.filter(
						(p: SchemaProperty): object|any[] => p.properties || p.enum,
						)
					: null;
		if (Array.isArray(defOrPropDescription)) {
			// Todo: Generalize these to go through the array, then merge enum with props if needed
			const hasPropertiesProp = traverseAndGetProperties(
				defOrPropDescription,
				"properties",
			) as boolean;
			const hasEnumProp: boolean = traverseAndGetProperties(
				defOrPropDescription,
				"enum",
			) as boolean;
			/* as we know he schema only has two arrays that might hold our values,
				* check them for either having arr.enum or arr.properties
			*/
			if (hasPropertiesProp) {
				defOrPropDescription =
					defOrPropDescription[0].properties ||
					defOrPropDescription[1].properties;
				if (!defOrPropDescription) {
					defOrPropDescription = defOrPropDescription[0].enum;
				}
				// TODO: manually implement stats and devtools like sourcemaps
			} else if (hasEnumProp) {
				const originalPropDesc: object = defOrPropDescription[0].enum;
				// Array -> Object -> Merge objects into one for compat in manualOrListInput
				defOrPropDescription = Object.keys(defOrPropDescription[0].enum)
					.map((p: string): object => {
						return {
							[originalPropDesc[p]]: "noop",
						}
					})
					.reduce((result: object, currentObject: object): object => {
						for (const key in currentObject) {
							if (currentObject.hasOwnProperty(key)) {
								result[key] = currentObject[key];
							}
						}
						return result;
					}, {});
			}
		}
		// WDS has its own schema, so we gonna need to check that too
		const webpackDevserverSchemaProp: SchemaProperties =
			action === "devServer" ? webpackDevServerSchema : null;
		// Watch has a boolean arg, but we need to append to it manually
		if (action === "watch") {
			defOrPropDescription = {
				false: {},
				true: {},
			};
		}
		if (action === "mode") {
			defOrPropDescription = {
				development: {},
				production: {},
			};
		}
		action = originalAction;
		if (action === "resolveLoader") {
			defOrPropDescription = Object.assign(defOrPropDescription, {
				moduleExtensions: {},
			});
		}
		// If we've got a schema prop or devServer Schema Prop
		if (defOrPropDescription || webpackDevserverSchemaProp) {
			// Check for properties in definitions[action] or properties[action]
			if (defOrPropDescription) {
				if (action !== "devtool") {
					// Add the option of adding an own variable if the user wants
					defOrPropDescription = Object.assign(defOrPropDescription, {
						other: {},
					});
				} else {
					// The schema doesn't have the source maps we can prompt, so add those
					defOrPropDescription = Object.assign(defOrPropDescription, {
						"cheap-eval-source-map": {},
						"cheap-module-eval-source-map": {},
						"cheap-module-source-map": {},
						"cheap-source-map": {},
						"eval": {},
						"eval-source-map": {},
						"hidden-source-map": {},
						"inline-cheap-module-source-map": {},
						"inline-cheap-source-map": {},
						"inline-source-map": {},
						"nosources-source-map": {},
						"source-map": {},
					});
				}
				inputPrompt = List(
					"actionAnswer",
					`What do you want to add to ${action}?`,
					Object.keys(defOrPropDescription),
				);
				// We know we're gonna append some deep prop like module.rule
				isDeepProp[0] = true;
			} else if (webpackDevserverSchemaProp) {
				// Append the custom property option
				webpackDevserverSchemaProp.properties = Object.assign(
					webpackDevserverSchemaProp.properties,
					{
						other: {},
					},
				);
				inputPrompt = List(
					"actionAnswer",
					`What do you want to add to ${action}?`,
					Object.keys(webpackDevserverSchemaProp.properties),
				);
				// We know we are in a devServer.prop scenario
				isDeepProp[0] = true;
			} else {
				// manual input if non-existent
				inputPrompt = manualOrListInput(action);
			}
		} else {
			inputPrompt = manualOrListInput(action);
		}

		const answerToAction = await this.prompt([
			inputPrompt,
		]);

		if (!answerToAction) {
			return;
		}
		/*
		* Plugins got their own logic,
		* find the names of each natively plugin and check if it matches
		*/
		if (action === "plugins") {
			const pluginExist: string = glob
				.sync([
					"node_modules/webpack/lib/*Plugin.js",
					"node_modules/webpack/lib/**/*Plugin.js",
				])
				.map((p: string): string =>
					p
						.split("/")
						.pop()
						.replace(".js", ""),
				)
				.find(
					(p: string): boolean => p.toLowerCase().indexOf(answerToAction.actionAnswer) >= 0,
				);

			if (pluginExist) {
				this.configuration.config.item = pluginExist;
				const pluginsSchemaPath: string = glob
					.sync([
						"node_modules/webpack/schemas/plugins/*Plugin.json",
						"node_modules/webpack/schemas/plugins/**/*Plugin.json",
					])
					.find(
						(p: string): boolean =>
							p
								.split("/")
								.pop()
								.replace(".json", "")
								.toLowerCase()
								.indexOf(answerToAction.actionAnswer) >= 0,
					);

				if (pluginsSchemaPath) {
					const constructorPrefix: string =
						pluginsSchemaPath.indexOf("optimize") >= 0
							? "webpack.optimize"
							: "webpack";
					const resolvePluginsPath: string = path.resolve(pluginsSchemaPath);
					const pluginSchema: object = resolvePluginsPath
						? require(resolvePluginsPath)
						: null;
					let pluginsSchemaProps: string[] = ["other"];
					if (pluginSchema) {
						Object.keys(pluginSchema)
							.filter((p: string): boolean => Array.isArray(pluginSchema[p]))
							.forEach((p: string): void => {
								Object.keys(pluginSchema[p]).forEach((n: string): void => {
									if (pluginSchema[p][n].properties) {
										pluginsSchemaProps = Object.keys(
											pluginSchema[p][n].properties,
										);
									}
								});
							});
					}

					const pluginsPropAnswer = await this.prompt([
						List(
							"pluginsPropType",
							`What property do you want to add ${pluginExist}?`,
							pluginsSchemaProps,
						),
					]);

					const valForProp = await this.prompt([
						Input(
							"pluginsPropTypeVal",
							`What value should ${pluginExist}.${
								pluginsPropAnswer.pluginsPropType
							} have?`,
						),
					]);

					this.configuration.config.webpackOptions[action] = [{
						[`${constructorPrefix}.${pluginExist}`]: {
							[pluginsPropAnswer.pluginsPropType]:
								valForProp.pluginsPropTypeVal,
						},
					}];

					return;
				} else {
					this.configuration.config.webpackOptions[
						action
					] = `new webpack.${pluginExist}`;
					return;
				}
			} else {
				// If its not in webpack, check npm
				npmExists(answerToAction.actionAnswer)
					.then((p: string): void => {
						if (p) {
							this.dependencies.push(answerToAction.actionAnswer);
							const normalizePluginName: string = answerToAction.actionAnswer.replace(
								"-webpack-plugin",
								"Plugin",
							);
							const pluginName = generatePluginName(answerToAction.actionAnswer);
							this.configuration.config.topScope.push(
								`const ${pluginName} = require("${
									answerToAction.actionAnswer
								}")`,
							);
							this.configuration.config.webpackOptions[
								action
							] = `new ${pluginName}`;
							this.configuration.config.item = answerToAction.actionAnswer;
							this.scheduleInstallTask(getPackageManager(), this.dependencies, {
								"save-dev": true,
							});
							return;
						} else {
							console.error(
								answerToAction.actionAnswer,
								"doesn't exist on NPM or is built in webpack, please check for any misspellings.",
							);
							process.exit(0);
						}
					});
			}
		} else {
			// If we're in the scenario with a deep-property
			if (isDeepProp[0]) {
				isDeepProp[1] = answerToAction.actionAnswer;
				if (
					isDeepProp[1] !== "other" &&
					(action === "devtool" || action === "watch" || action === "mode")
				) {
					this.configuration.config.item = action;
					(this.configuration.config.webpackOptions[action] as any) =
						answerToAction.actionAnswer;
					return;
				}
				// Either we are adding directly at the property, else we're in a prop.theOne scenario
				const actionMessage: string =
					isDeepProp[1] === "other"
						? `What do you want the key on ${
							action
							} to be? (press enter if you want it directly as a value on the property)`
						: `What do you want the value of ${isDeepProp[1]} to be?`;

				const deepPropAns = await this.prompt([
					Input("deepProp", actionMessage),
				]);

				// The other option needs to be validated of either being empty or not
				if (isDeepProp[1] === "other") {
					const othersDeepPropKey: string = deepPropAns.deepProp
						? `What do you want the value of ${
							deepPropAns.deepProp
							} to be?` // eslint-disable-line
						: `What do you want to be the value of ${action} to be?`;
					// Push the answer to the array we have created, so we can use it later
					isDeepProp.push(deepPropAns.deepProp);
					const innerPropAns = await this.prompt([
						Input("innerProp", othersDeepPropKey),
					]);

					// Check length, if it has none, add the prop directly on the given action
					if (isDeepProp[2].length === 0) {
						this.configuration.config.item = action;
						this.configuration.config.webpackOptions[action] =
							innerPropAns.innerProp;
					} else {
						// If not, we're adding to something like devServer.myProp
						this.configuration.config.item =
							action + "." + isDeepProp[2];
						this.configuration.config.webpackOptions[action] = {
							[isDeepProp[2]]: innerPropAns.innerProp,
						};
					}
					return;

				} else {
					// We got the schema prop, we've correctly prompted it, and can add it directly
					this.configuration.config.item = action + "." + isDeepProp[1];
					this.configuration.config.webpackOptions[action] = {
						[isDeepProp[1]]: deepPropAns.deepProp,
					};
					return;
				}
			} else {
				// We're asking for input-only
				this.configuration.config.item = action;
				this.configuration.config.webpackOptions[action] =
					answerToAction.actionAnswer;
				return;
			}
		}
	}

	public writing(): void {
		this.config.set("configuration", this.configuration);
	}
}
