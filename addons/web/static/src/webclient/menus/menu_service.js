import { computed, signal, t, useListener, usePlugin } from "@odoo/owl";
import { DebugModePlugin } from "@web/core/debug_mode_plugin";
import { rpcBus } from "@web/core/network/rpc";
import { offlineScope } from "@web/core/offline/offline_scope";
import { user } from "@web/core/user";
import { registry } from "@web/core/registry";
import { IndexedDB } from "@web/core/utils/indexed_db";
import { session } from "@web/session";

export const menuService = {
    dependencies: ["action"],
    async start(env, { action }) {
        /**
         * @param {boolean} [reload=false]
         */
        async function fetchMenus(reload) {
            if (!reload && odoo.loadMenusPromise) {
                return odoo.loadMenusPromise;
            }
            const res = await fetch(loadMenusUrl, {
                cache: "no-store",
                headers: { "X-Odoo-Account": `${user.userId}@${session.db}` },
            });
            if (!res.ok) {
                throw new Error("Error while fetching menus");
            }
            return res.json();
        }

        /**
         * @param {string | number} menuId
         */
        function getMenu(menuId) {
            return menusData()[menuId];
        }

        /**
         * @param {string | number | Record<string, any>} menu
         */
        function setCurrentMenu(menu) {
            menu = typeof menu === "number" ? getMenu(menu) : menu;
            if (menu && menu.appID !== currentAppId()) {
                currentAppId.set(menu.appID ?? null);
                sessionStorage.setItem("menu_id", menu.appID);
                env.bus.trigger("MENUS:APP-CHANGED");
            }
        }

        const currentAppId = signal(null, {
            type: t.or([t.string(), t.number(), t.literal(null)]),
        });
        const menusData = signal(null, { type: t.record(t.string()) });

        const openMenuDB = () => new IndexedDB(offlineScope("webclient_menu"), session.registry_hash);
        const menuDB = openMenuDB();
        const table = "menu";
        const debugMode = usePlugin(DebugModePlugin);
        const key = JSON.stringify({ debug: debugMode.isActive() });
        const loadMenusUrl = `/web/webclient/load_menus`;

        let activeMenuDB = menuDB;
        let pendingMenuDB;
        let fetchingMenuDB;
        const refreshAuthorizedMenus = async () => {
            const db = pendingMenuDB;
            if (!db || db === fetchingMenuDB) {
                return;
            }
            fetchingMenuDB = db;
            try {
                const menus = await fetchMenus(true);
                if (db === pendingMenuDB) {
                    menusData.set(menus);
                    pendingMenuDB = undefined;
                    env.bus.trigger("MENUS:APP-CHANGED");
                    await db.write(table, key, JSON.stringify(menus));
                }
            } catch {
                // A subsequent successful authenticated request can retry.
            } finally {
                if (db === fetchingMenuDB) {
                    fetchingMenuDB = undefined;
                }
            }
        };
        useListener(rpcBus, "OFFLINE:ACCESS-CHANGED", () => {
            activeMenuDB = pendingMenuDB = openMenuDB();
            refreshAuthorizedMenus();
        });
        useListener(rpcBus, "RPC:RESPONSE", ({ detail }) => {
            if (pendingMenuDB && !detail.error) {
                refreshAuthorizedMenus();
            }
        });

        const storedMenus = await menuDB.read(table, key);
        if (storedMenus && menuDB === activeMenuDB) {
            fetchMenus().then((res) => {
                if (res && menuDB === activeMenuDB) {
                    const fetchedMenus = JSON.stringify(res);
                    if (fetchedMenus !== storedMenus) {
                        menuDB.write(table, key, fetchedMenus);
                        menusData.set(res);
                        env.bus.trigger("MENUS:APP-CHANGED");
                    }
                }
            }).catch((error) => {
                if (!(error instanceof TypeError)) {
                    throw error;
                }
                // A disconnected client can continue with its own stored menus.
            });
            menusData.set(JSON.parse(storedMenus));
        }
        while (!menusData()) {
            const db = activeMenuDB;
            const fetchedMenus = await fetchMenus(db !== menuDB);
            if (db === activeMenuDB) {
                menusData.set(fetchedMenus);
                if (fetchedMenus) {
                    db.write(table, key, JSON.stringify(fetchedMenus));
                }
                break;
            }
        }

        return {
            getAll: computed(() => Object.values(menusData())),
            getApps: computed(() => getMenu("root").children.map(getMenu)),
            getCurrentApp: computed(() => currentAppId() && getMenu(currentAppId())),
            getMenu,
            getMenuAsTree(menuID) {
                const menu = getMenu(menuID);
                if (!menu.childrenTree) {
                    menu.childrenTree = menu.children.map((mid) => this.getMenuAsTree(mid));
                }
                return menu;
            },
            async reload() {
                const db = activeMenuDB;
                const menus = await fetchMenus(true);
                if (db === activeMenuDB) {
                    menusData.set(menus);
                    db.write(table, key, JSON.stringify(menus));
                    env.bus.trigger("MENUS:APP-CHANGED");
                }
            },
            async selectMenu(menu) {
                menu = typeof menu === "number" ? getMenu(menu) : menu;
                if (!menu.actionID) {
                    return;
                }
                await action.doAction(menu.actionID, {
                    clearBreadcrumbs: true,
                    onActionReady: () => {
                        setCurrentMenu(menu);
                    },
                });
            },
            setCurrentMenu,
        };
    },
};

registry.category("services").add("menu", menuService);
