// Type definitions for passport-localapikey-es6 0.5
// Project: https://github.com/gregbacchus/passport-localapikey#readme
// Definitions by: Steffen Grimm <https://github.com/me>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="passport"/>

import { Strategy as PassportStrategy } from "passport-strategy";
import express = require("express");

interface IStrategyOptions {
    apiKeyField?: string;
    apiKeyHeader?: string;
    session?: boolean;
    passReqToCallback?: false;
}

interface IStrategyOptionsWithRequest {
    apiKeyField?: string;
    apiKeyHeader?: string;
    session?: boolean;
    passReqToCallback: true;
}

interface IVerifyOptions {
    message: string;
}

interface VerifyFunctionWithRequest {
    (
        req: express.Request,
        apikey: string,
        done: (error: any, user?: any, options?: IVerifyOptions) => void
    ): void;
}

interface VerifyFunction {
    (
        apikey: string,
        done: (error: any, user?: any, options?: IVerifyOptions) => void
    ): void;
}

declare class Strategy extends PassportStrategy {
    constructor(
        options: IStrategyOptionsWithRequest,
        verify: VerifyFunctionWithRequest
    );
    constructor(options: IStrategyOptions, verify: VerifyFunction);
    constructor(verify: VerifyFunction);

    name: string;
}
