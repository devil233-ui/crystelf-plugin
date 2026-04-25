import js from "@eslint/js";
import globals from "globals";

export default [
    {
        // 对应原配置的 ignorePatterns
        ignores: [ "**/*.min.js" ]
    },
    js.configs.recommended,
    {
        languageOptions: {
            // 对应原配置的 parserOptions
            ecmaVersion: "latest",
            sourceType: "module",
            // 对应原配置的 env 和 globals
            globals: {
                ...globals.node,
                ...globals.es2021,
                ...globals.browser,
                jQuery: "readonly",
                Bot: "readonly",
                redis: "readonly",
                logger: "readonly",
                plugin: "readonly",
                Renderer: "readonly",
                segment: "readonly"
            }
        },
        rules: {
            // 原配置的基础核心规则，强制要求双引号
            "multiline-ternary": "off",
            "new-cap": "off",
            "eqeqeq": "off",
            "prefer-const": "off",
            "arrow-body-style": "off",
            "camelcase": "off",
            "no-labels": [ "error", { "allowLoop": true } ],
            "quotes": [ "error", "double" ],
            "quote-props": [ "error", "consistent" ],
            "no-eval": [ "error", { "allowIndirect": true } ],
            "array-bracket-newline": [ "error", { "multiline": true } ],
            "array-bracket-spacing": [ "error", "always" ],
            "space-before-function-paren": [ "error", "never" ],
            "no-invalid-this": "off",
            "no-case-declarations": "off",
            "no-prototype-builtins": "off",
            "no-undef": "off",
            "no-unused-vars": "off",
            "no-useless-assignment": "off",
            "no-empty": "off",
            "no-unassigned-vars": "off",
            "no-useless-escape": "off"
        }
    }
];