import { Message } from "@server/databases/imessage/entity/Message";
import { MessageChangeListener } from "./messageChangeListener";
import { DBWhereItem } from "../types";
import { isNotEmpty } from "@server/helpers/utils";
import { isMinVentura } from "@server/env";

export class IncomingMessageListener extends MessageChangeListener {
    async getEntries(after: Date, before: Date): Promise<void> {
        await this.emitNewMessages(after);

        const afterUpdateOffsetDate = new Date(after.getTime() - this.pollFrequency - 15000);
        await this.emitUpdatedMessages(afterUpdateOffsetDate);
    }

    async emitNewMessages(after: Date) {
        const where: DBWhereItem[] = [
            {
                statement: "message.is_from_me = :fromMe",
                args: { fromMe: 0 }
            }
        ];

        // If we have a last row id, only get messages after that
        if (this.lastRowId !== 0) {
            where.push({
                statement: "message.ROWID > :rowId",
                args: { rowId: this.lastRowId }
            });
        }

        // Do not use the "after" parameter if we have a last row id
        // Offset 15 seconds to account for the "Apple" delay
        const [entries, _] = await this.repo.getMessages({
            after: this.lastRowId === 0 ? new Date(after.getTime() - 15000) : null,
            withChats: true,
            where,
            orderBy: this.lastRowId === 0 ? "message.dateCreated" : "message.ROWID"
        });

        // The 0th entry should be the newest since we sort by DESC
        if (isNotEmpty(entries)) {
            this.lastRowId = entries[0].ROWID;
        }

        // Emit the new message
        entries.forEach(async (entry: Message) => {
            const event = this.processMessageEvent(entry);
            if (!event) return;

            // Emit the event
            super.emit(event, this.transformEntry(entry));
        });
    }

    async emitUpdatedMessages(after: Date) {
        // An incoming message is only updated if it was unsent or edited.
        // This functionality is only available on macOS Ventura and newer.
        // Exit early to prevent over processing.
        if (!isMinVentura) return;

        // Get updated entries from myself only
        const entries = await this.repo.getUpdatedMessages({
            after,
            withChats: true,
            where: [
                {
                    statement: "message.is_from_me = :isFromMe",
                    args: { isFromMe: 0 }
                }
            ]
        });

        // Emit the new message
        entries.forEach(async (entry: Message) => {
            // If there is no edited/retracted date, it's not an updated message.
            // We only care about edited/retracted messages.
            // The other dates are delivered, read, and played.
            if (!entry.dateEdited && !entry.dateRetracted) return;

            const event = this.processMessageEvent(entry);
            if (!event) return;

            // Emit the event
            super.emit(event, this.transformEntry(entry));
        });
    }

    // eslint-disable-next-line class-methods-use-this
    transformEntry(entry: Message) {
        return entry;
    }
}
