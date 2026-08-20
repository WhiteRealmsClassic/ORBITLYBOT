import { Events } from 'discord.js';

import { logger } from '../utils/logger.js';

import { getLevelingConfig, getUserLevelData } from '../services/leveling/leveling.js';

import { addXp } from '../services/leveling/xpSystem.js';

import { checkRateLimit } from '../utils/rateLimiter.js';
import { parsePrefixCommand } from '../utils/prefixParser.js';

import { supportsPrefixExecution, executePrefixCommand, resolvePrefixAccessKey } from '../utils/messageAdapter.js';

import { resolveCommandAlias, resolveSubcommandAlias } from '../config/commands/commandAliases.js';

import { getPrefixRestriction } from '../config/commands/prefixRestrictions.js';

import { getGuildConfig } from '../services/config/guildConfig.js';

import {
    getCommandPrefix,
    getBotMessage,
    isBotOwner,
    isCommandCategoryEnabled,
    isMaintenanceMode
} from '../config/bot.js';

import { enforceAbuseProtection, formatCooldownDuration } from '../utils/abuseProtection.js';

import { createEmbed } from '../utils/embeds.js';

import { isCommandEnabled } from '../services/commandAccessService.js';

import {
    getCountingGameConfig,
    saveCountingGameConfig,
    isValidCountingMessage,
    recordCorrectCount
} from '../services/countingGameService.js';

import { askGroq } from '../services/GroqService.js';

import { getRobloxStatus } from '../services/robloxService.js';


const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;

const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;


export default {

    name: Events.MessageCreate,

    async execute(message, client) {

        try {

            // Ignore messages sent by bots

            if (message.author.bot) return;


            // =========================
            // GROQ AI DM HANDLER
            // =========================

            if (!message.guild) {

                await handleDM(message);

                return;

            }


            // =========================
            // SERVER MESSAGE HANDLING
            // =========================

            logger.debug(
                `Message received from ${message.author.tag}: ${message.content}`
            );


            // =========================
            // COUNTING GAME
            // =========================

            const countingProcessed = await handleCountingGame(message, client);

            if (countingProcessed) {

                return;

            }


            // =========================
            // ROBLOX STATUS
            // =========================

            const robloxProcessed = await handleRobloxMention(message, client);

            if (robloxProcessed) {

                return;

            }


            // =========================
            // PREFIX COMMANDS
            // =========================

            await handlePrefixCommand(message, client);


            // =========================
            // LEVELING
            // =========================

            await handleLeveling(message, client);


        } catch (error) {

            logger.error(
                'Error in messageCreate event:',
                error
            );

        }

    }

};


/**
 * Handles Roblox status requests made by mentioning ORBITLY.
 *
 * Examples:
 *
 * @ORBITLY is White online?
 * @ORBITLY check White
 * @ORBITLY status White
 * @ORBITLY where is White?
 */

async function handleRobloxMention(message, client) {

    try {

        if (!client.user) {

            return false;

        }


        // Only respond when ORBITLY itself is mentioned.

        if (!message.mentions.users.has(client.user.id)) {

            return false;

        }


        // Remove the ORBITLY mention from the message.

        const content = message.content
            .replace(
                new RegExp(`<@!?${client.user.id}>`, 'g'),
                ''
            )
            .trim();


        // Try to extract a Roblox username.

        const match = content.match(
            /(?:is|check|status(?:\s+of)?|where\s+is|what(?:\s+is)?\s+)([A-Za-z0-9_]{3,20})/i
        );


        // The message mentioned ORBITLY, but wasn't a Roblox request.

        if (!match) {

            return false;

        }


        const username = match[1];


        logger.info(
            `Roblox status request for ${username} by ${message.author.tag}`
        );


        await message.channel.sendTyping();


        const result = await getRobloxStatus(username);


        // =========================
        // USER NOT FOUND
        // =========================

        if (!result.found) {

            await message.reply(
                `❌ I couldn't find a Roblox user named **${username}**.`
            );

            return true;

        }


        const presence = result.presence;


        // =========================
        // NO PRESENCE DATA
        // =========================

        if (!presence) {

            await message.reply(
                `🔴 **${result.user.name}** is offline.`
            );

            return true;

        }


        // =========================
        // ROBLOX PRESENCE TYPES
        // =========================

        const statuses = {

            0: '🔴 Offline',

            1: '🟢 Online',

            2: '🎮 In Game',

            3: '🛠️ In Roblox Studio',

            4: '📱 Online'

        };


        const status =
            statuses[presence.userPresenceType] ??
            '❓ Unknown';


        // =========================
        // RESPONSE
        // =========================

        await message.reply(

            `**${result.user.name}** is currently **${status}**.`

        );


        return true;


    } catch (error) {

        logger.error(
            'Roblox presence lookup failed:',
            error
        );


        await message.reply(
            '⚠️ I couldn’t check Roblox right now.'
        ).catch(() => {});


        return true;

    }

}


async function handlePrefixCommand(message, client) {

    try {

        const guildConfig =
            await getGuildConfig(
                client,
                message.guild.id
            );


        const prefix =
            guildConfig?.prefix ||
            getCommandPrefix();


        const parsed =
            parsePrefixCommand(
                message.content,
                prefix
            );


        if (!parsed) {

            return;

        }


        let {
            commandName,
            args
        } = parsed;


        const musicPrefixShortcut =
            commandName.toLowerCase();


        const MUSIC_PREFIX_SHORTCUTS =
            new Set([
                'leave',
                'pause',
                'resume',
                'skip',
                'stop',
                'volume'
            ]);


        if (
            MUSIC_PREFIX_SHORTCUTS.has(
                musicPrefixShortcut
            )
        ) {

            commandName = 'music';

            args = [
                musicPrefixShortcut,
                ...args
            ];

        }


        logger.info(
            `Prefix command detected: ${commandName}, args: ${args.join(', ')}`
        );


        const resolvedCommandName =
            resolveCommandAlias(commandName);


        logger.info(
            `Resolved command name: ${resolvedCommandName}`
        );


        const command =
            client.commands.get(
                resolvedCommandName
            );


        if (!command) {

            logger.warn(
                `Command not found: ${resolvedCommandName}`
            );

            return;

        }


        if (
            isMaintenanceMode() &&
            !isBotOwner(message.author.id)
        ) {

            await message.channel.send({

                embeds: [

                    createEmbed({

                        title: 'Maintenance Mode',

                        description:
                            getBotMessage(
                                'maintenanceMode'
                            ),

                        color: 'warning'

                    })

                ]

            }).catch(() => {});


            return;

        }


        if (
            !isCommandCategoryEnabled(
                command.category
            )
        ) {

            await message.channel.send({

                embeds: [

                    createEmbed({

                        title: 'Feature Disabled',

                        description:
                            getBotMessage(
                                'commandDisabled'
                            ),

                        color: 'error'

                    })

                ]

            }).catch(() => {});


            return;

        }


        const restriction =
            getPrefixRestriction(
                command,
                args,
                resolveSubcommandAlias
            );


        if (
            !supportsPrefixExecution(command) ||
            restriction.blocked
        ) {

            if (
                restriction.blocked &&
                restriction.reason
            ) {

                const embed =
                    createEmbed({

                        title:
                            'Slash Command Only',

                        description:
                            `${restriction.reason}\nUse \`/${resolvedCommandName}\` instead.`,

                        color: 'info'

                    });


                await message.channel
                    .send({
                        embeds: [embed]
                    })
                    .catch(() => {});

            }


            return;

        }


        if (
            !(await isCommandEnabled(

                client,

                message.guild.id,

                resolvePrefixAccessKey(
                    command.data,
                    args
                ),

                command.category

            ))
        ) {

            const embed =
                createEmbed({

                    title:
                        'Command Disabled',

                    description:
                        'This command has been disabled for this server.',

                    color: 'error'

                });


            await message.channel
                .send({
                    embeds: [embed]
                })
                .catch(() => {});


            return;

        }


        const mockInteractionForProtection = {

            guildId:
                message.guild.id,

            user:
                message.author

        };


        const abuseProtection =
            await enforceAbuseProtection(

                mockInteractionForProtection,

                command,

                resolvedCommandName

            );


        if (!abuseProtection.allowed) {

            const formattedCooldown =
                formatCooldownDuration(
                    abuseProtection.remainingMs
                );


            const embed =
                createEmbed({

                    title:
                        'Command Cooldown',

                    description:
                        `This command is on cooldown. Please wait ${formattedCooldown} before trying again.`,

                    color: 'error'

                });


            await message.channel
                .send({
                    embeds: [embed]
                })
                .catch(() => {});


            return;

        }


        logger.info(
            `Executing prefix command: ${prefix}${commandName} (resolved to ${resolvedCommandName}) by ${message.author.tag}`
        );


        await executePrefixCommand(

            command,

            message,

            args,

            client,

            prefix,

            guildConfig

        );


    } catch (error) {

        logger.error(
            'Error handling prefix command:',
            error
        );

    }

}


async function handleCountingGame(message, client) {

    try {

        const config =
            await getCountingGameConfig(
                client,
                message.guild.id
            );


        if (
            !config.enabled ||
            !config.channelId ||
            message.channel.id !== config.channelId
        ) {

            return false;

        }


        const content =
            message.content.trim();


        const validCount =
            isValidCountingMessage(
                content,
                config
            );


        const invalidAttempt =
            !validCount ||
            message.author.id === config.lastUserId;


        if (invalidAttempt) {

            await message.delete()
                .catch(() => {});


            await saveCountingGameConfig(

                client,

                message.guild.id,

                {

                    ...config,

                    nextNumber: 1,

                    lastUserId: null,

                    currentStreak: 0

                }

            );


            const failureMessage =
                await message.channel.send(

                    `❌ Count broken by <@${message.author.id}>. The sequence has been reset to **1**.`

                );


            setTimeout(() => {

                failureMessage
                    .delete()
                    .catch(() => {});

            }, 10000);


            return true;

        }


        await recordCorrectCount(

            client,

            message.guild.id,

            message.author.id

        );


        return true;


    } catch (error) {

        logger.error(
            'Error handling counting game:',
            error
        );


        return false;

    }

}


async function handleLeveling(message, client) {

    try {

        const rateLimitKey =
            `xp-event:${message.guild.id}:${message.author.id}`;


        const canProcess =
            await checkRateLimit(

                rateLimitKey,

                MESSAGE_XP_RATE_LIMIT_ATTEMPTS,

                MESSAGE_XP_RATE_LIMIT_WINDOW_MS

            );


        if (!canProcess) {

            return;

        }


        const config =
            await getLevelingConfig(

                client,

                message.guild.id

            );


        if (!config?.enabled) {

            return;

        }


        const userData =
            await getUserLevelData(

                client,

                message.guild.id,

                message.author.id

            );


        const result =
            await addXp(

                client,

                message.guild.id,

                message.author.id,

                userData,

                config

            );


        if (
            result?.levelUp &&
            result.newLevel
        ) {

            const embed =
                createEmbed({

                    title:
                        'Level Up!',

                    description:
                        `Congratulations <@${message.author.id}>! You reached **Level ${result.newLevel}**.`,

                    color: 'success'

                });


            await message.channel
                .send({
                    embeds: [embed]
                })
                .catch(() => {});

        }


    } catch (error) {

        logger.error(
            'Error handling leveling:',
            error
        );

    }

}


async function handleDM(message) {

    try {

        const content =
            message.content.trim();


        if (!content) {

            return;

        }


        const response =
            await askGroq(content);


        if (!response) {

            return;

        }


        await message.reply(response);

    } catch (error) {

        logger.error(
            'Error handling DM:',
            error
        );

    }

}
