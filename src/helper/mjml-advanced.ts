import { existsSync, readFileSync } from 'fs';
//import { mjml2html } from 'mjml';
import * as Handlebars from "handlebars";
import { join, dirname } from "path";
import mjml2html = require('mjml');

export class MJMLAdvanced {
    private hb: typeof Handlebars;
    private rootPath: string;
    private rootFile: string;

    constructor(templatePath?: string) {
        this.hb = Handlebars.noConflict();
        const loadTemplate = this.loadTemplate.bind(this);

        this.hb.registerHelper('include', function(fileName, options) {
            let file = loadTemplate(fileName);
            return Handlebars.compile(file)(this,options);
        });

        this.hb.registerHelper('switch', function(value, options) {
            this.switch_value = value;
            return options.fn(this);
        });
          
        this.hb.registerHelper('case', function(value, options) {
            if (value == this.switch_value) {
                return options.fn(this);
            }
        });

        if(templatePath) {
            this.rootPath = dirname(templatePath);
            this.rootFile = loadTemplate(templatePath, true);
        }
    }

    private loadTemplate(fileName: string, isFull = false) {
        if(typeof fileName === typeof undefined)
            throw Error("No path specified");
        const path = isFull ? fileName : join(this.rootPath,fileName);
        if(existsSync(path))
            return readFileSync(path).toString('utf8');
        throw Error("Not found: "+path);
    }

    public compile(templatePath?: string) {
        if(templatePath) {
            this.rootPath = dirname(templatePath);
            this.rootFile = this.loadTemplate(templatePath, true);
        } else if(!this.rootPath)
            throw Error("No file specified");

        return (data: any) => {
            let result = mjml2html(this.rootFile, {
                preprocessors: [
                    (xml) => {
                        return this.hb.compile(xml,{noEscape: true})(data)
                    }
                ],
                ignoreIncludes: true,
                minify: true
            });
                
            if(result.errors.length)
                throw new Error(result.errors.join(','));
                
            return result.html
        };
    }

    public registerHelper(name: string, fn: Handlebars.HelperDelegate) {
        this.hb.registerHelper(name, fn);
    }

    public registerPartial(name: string, fn: Handlebars.Template<any>) {
        this.hb.registerPartial(name, fn);
    }
}