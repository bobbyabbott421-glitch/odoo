import { CrmColumnProgress } from "./crm_column_progress";
import { RottingKanbanHeader } from "@mail/js/rotting_mixin/rotting_kanban_header";
import { RottingKanbanRenderer } from "@mail/js/rotting_mixin/rotting_kanban_renderer";

class CrmKanbanHeader extends RottingKanbanHeader {
    static components = {
        ...RottingKanbanHeader.components,
        ColumnProgress: CrmColumnProgress,
    };
}

export class CrmKanbanRenderer extends RottingKanbanRenderer {
    get canResequenceGroups() {
        return !this.env.services.offline.offline && super.canResequenceGroups;
    }

    get canResequenceRecords() {
        return !this.env.services.offline.offline && super.canResequenceRecords;
    }

    static components = {
        ...RottingKanbanRenderer.components,
        KanbanHeader: CrmKanbanHeader,
    };
}
