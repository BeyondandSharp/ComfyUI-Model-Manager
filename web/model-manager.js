import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyDialog, $el } from "../../scripts/ui.js";
import { ComfyButton } from "../../scripts/ui/components/button.js";

/**
 * @param {string} url
 * @param {any} [options=undefined]
 * @returns {Promise}
 */
function request(url, options = undefined) {
    return new Promise((resolve, reject) => {
        api.fetchApi(url, options)
            .then((response) => response.json())
            .then(resolve)
            .catch(reject);
    });
}

/**
 * @param {string} url
 */
async function loadWorkflow(url) {
    const uri = (new URL(url)).searchParams.get("uri");
    const fileNameIndex = Math.max(uri.lastIndexOf("/"), uri.lastIndexOf("\\")) + 1;
    const fileName = uri.substring(fileNameIndex);
    const response = await fetch(url);
    const data = await response.blob();
    const file = new File([data],  fileName, { type: data.type });
    app.handleFile(file);
}

const modelNodeType = {
    "checkpoints": "CheckpointLoaderSimple",
    "clip": "CLIPLoader",
    "clip_vision": "CLIPVisionLoader",
    "controlnet": "ControlNetLoader",
    "diffusers": "DiffusersLoader",
    "embeddings": "Embedding",
    "gligen": "GLIGENLoader",
    "hypernetworks": "HypernetworkLoader",
    "photomaker": "PhotoMakerLoader",
    "loras": "LoraLoader",
    "style_models": "StyleModelLoader",
    "unet": "UNETLoader",
    "upscale_models": "UpscaleModelLoader",
    "vae": "VAELoader",
    "vae_approx": undefined,
};

const MODEL_EXTENSIONS = [".bin", ".ckpt", ".onnx", ".pt", ".pth", ".safetensors"]; // TODO: ask server for?
const IMAGE_EXTENSIONS = [
    ".png", 
    ".webp", 
    ".jpeg", 
    ".jpg", 
    ".gif", 
    ".apng", 

    ".preview.png", 
    ".preview.webp", 
    ".preview.jpeg", 
    ".preview.jpg", 
    ".preview.gif", 
    ".preview.apng", 
]; // TODO: /model-manager/image/extensions

/**
 * @param {string} s
 * @param {string} prefix
 * @returns {string}
 */
function removePrefix(s, prefix) {
    if (s.length >= prefix.length && s.startsWith(prefix)){
        return s.substring(prefix.length);
    }
    return s;
}

/**
 * @param {string} s
 * @param {string} suffix
 * @returns {string}
 */
function removeSuffix(s, suffix) {
    if (s.length >= suffix.length && s.endsWith(suffix)){
        return s.substring(0, s.length - suffix.length);
    }
    return s;
}

class SearchPath {
    /**
     * @param {string} path
     * @returns {[string, string]}
     */
    static split(path) {
        const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
        return [path.slice(0, i), path.slice(i)];
    }

    /**
     * @param {string} path
     * @param {string[]} extensions
     * @returns {[string, string]}
     */
    static splitExtension(path) {
        const i = path.lastIndexOf(".");
        if (i === -1) {
            return [path, ""];
        }
        return [path.slice(0, i), path.slice(i)];
    }

    /**
     * @param {string} path
     * @returns {string}
     */
    static systemPath(path, searchSeparator, systemSeparator) {
        const i1 = path.indexOf(searchSeparator, 1);
        const i2 = path.indexOf(searchSeparator, i1 + 1);
        return path.slice(i2 + 1).replaceAll(searchSeparator, systemSeparator);
    }
}

/**
 * @param {string | undefined} [searchPath=undefined]
 * @param {string | undefined} [dateImageModified=undefined]
 * @param {string | undefined} [width=undefined]
 * @param {string | undefined} [height=undefined]
 * @param {string | undefined} [imageFormat=undefined]
 * @returns {string}
 */
function imageUri(imageSearchPath = undefined, dateImageModified = undefined, width = undefined, height = undefined, imageFormat = undefined) {
    const path = imageSearchPath ?? "no-preview";
    const date = dateImageModified;
    let uri = `/model-manager/preview/get?uri=${path}`;
    if (width !== undefined && width !== null) {
        uri += `&width=${width}`;
    }
    if (height !== undefined && height !== null) {
        uri += `&height=${height}`;
    }
    if (date !== undefined && date !== null) {
        uri += `&v=${date}`;
    }
    if (imageFormat !== undefined && imageFormat !== null) {
        uri += `&image-format=${imageFormat}`;
    }
    return uri;
}
const PREVIEW_NONE_URI = imageUri();
const PREVIEW_THUMBNAIL_WIDTH = 320;
const PREVIEW_THUMBNAIL_HEIGHT = 480;

/**
 * @param {(...args) => void} callback
 * @param {number | undefined} delay
 * @returns {(...args) => void}
 */
function debounce(callback, delay) {
    let timeoutId = null;
    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
            callback(...args);
        }, delay);
    };
}

/**
 * 
 * @param {HTMLButtonElement} element
 * @returns {[HTMLButtonElement | undefined, HTMLElement | undefined, HTMLSpanElement | undefined]} [button, icon, span]
 */
function comfyButtonDisambiguate(element) {
    let button = undefined;
    let icon = undefined;
    let span = undefined;
    const nodeName = element.nodeName.toLowerCase();
    if (nodeName === "button") {
        button = element;
        icon = button.getElementsByTagName("i")[0];
        span = button.getElementsByTagName("span")[0];
    }
    else if (nodeName === "i") {
        icon = element;
        button = element.parentElement;
        span = button.getElementsByTagName("span")[0];
    }
    else if (nodeName === "span") {
        button = element.parentElement;
        icon = button.getElementsByTagName("i")[0];
        span = element;
    }
    return [button, icon, span]
}

/**
 * @param {HTMLButtonElement} element
 * @param {boolean} success
 * @param {string?} successClassName
 * @param {string?} failureClassName
 * @param {boolean?} [disableCallback=false]
 */
function comfyButtonAlert(element, success, successClassName = undefined, failureClassName = undefined, disableCallback = false) {
    if (element === undefined || element === null) { return; }
    
    const [button, icon, span] = comfyButtonDisambiguate(element);
    if (button === undefined) {
        console.warn("Unable to find button element!");
        console.warn(element);
        return;
    }
    
    // TODO: debounce would be nice, but needs some sort of "global" to avoid creating/destroying many objects
    
    const colorClassName = success ? "comfy-button-success" : "comfy-button-failure";
    
    if (icon) {
        const iconClassName = (success ? successClassName : failureClassName) ?? "";
        if (iconClassName !== "") {
            icon.classList.add(iconClassName);
        }
        icon.classList.add(colorClassName);
        if (!disableCallback) {
            window.setTimeout((element, iconClassName, colorClassName) => {
                if (iconClassName !== "") {
                    element.classList.remove(iconClassName);
                }
                element.classList.remove(colorClassName);
            }, 1000, icon, iconClassName, colorClassName);
        }
    }
    
    button.classList.add(colorClassName);
    if (!disableCallback) {
        window.setTimeout((element, colorClassName) => {
            element.classList.remove(colorClassName);
        }, 1000, button, colorClassName);
    }
}

/**
 * 
 * @param {string} modelPath
 * @param {string} newValue
 * @returns {Promise<boolean>}
 */
async function saveNotes(modelPath, newValue) {
    return await request(
        "/model-manager/notes/save",
        {
            method: "POST",
            body: JSON.stringify({
                "path": modelPath,
                "notes": newValue,
            }),
        }
    ).then((result) => {
        const saved = result["success"];
        const message = result["alert"];
        if (message !== undefined) {
            window.alert(message);
        }
        return saved;
    })
    .catch((err) => {
        console.warn(err);
        return false;
    });
}

/**
 * @returns {HTMLLabelElement}
 */
function $checkbox(x = { $: (el) => {}, textContent: "", checked: false }) {
    const text = x.textContent;
    const input = $el("input", {
        type: "checkbox", 
        name: text ?? "checkbox", 
        checked: x.checked ?? false, 
    });
    const label = $el("label", [
        input, 
        text === "" || text === undefined || text === null ? "" : " " + text,
    ]);
    if (x.$ !== undefined){
        x.$(input);
    }
    return label;
}

/**
 * @returns {HTMLLabelElement}
 */
function $select(x = { $: (el) => {}, textContent: "", options: [""] }) {
    const text = x.textContent;
    const select = $el("select", {
        name: text ?? "select",
    }, x.options.map((option) => {
        return $el("option", {
            value: option,
        }, option);
    }));
    const label = $el("label", [
        text === "" || text === undefined || text === null ? "" : " " + text,
        select,
    ]);
    if (x.$ !== undefined){
        x.$(select);
    }
    return label;
}

/**
 * @param {Any} attr
 * @returns {HTMLDivElement}
 */
function $radioGroup(attr) {
    const { name = Date.now(), onchange, options = [], $ } = attr;
    
    /** @type {HTMLDivElement[]} */
    const radioGroup = options.map((item, index) => {
        const inputRef = { value: null };
        
        return $el(
            "div.comfy-radio",
            { onclick: () => inputRef.value.click() },
            [
                $el("input.radio-input", {
                    type: "radio",
                    name: name,
                    value: item.value,
                    checked: index === 0,
                    $: (el) => (inputRef.value = el),
                }),
                $el("label.no-highlight", item.label ?? item.value),
            ]
        );
    });
    
    const element = $el("input", {
        name: name + "-group",
        value: options[0]?.value,
    });
    $?.(element);

    radioGroup.forEach((radio) => {
        radio.addEventListener("change", (event) => {
            const selectedValue = event.target.value;
            element.value = selectedValue;
            onchange?.(selectedValue);
        });
    });
    
    return $el("div.comfy-radio-group", radioGroup);
}

/**
 * @param {{name: string, icon: string, tabContent: HTMLDivElement}[]} tabData
 * @returns {[HTMLDivElement[], HTMLDivElement[]]}
 */
function GenerateTabGroup(tabData) {
    const ACTIVE_TAB_CLASS = "active";

    /** @type {HTMLDivElement[]} */
    const tabButtons = [];

    /** @type {HTMLDivElement[]} */
    const tabContents = [];

    tabData.forEach((data) => {
        const name = data.name;
        const icon = data.icon;
        /** @type {HTMLDivElement} */
        const tab = new ComfyButton({
            icon: icon,
            tooltip: "Open " + name.toLowerCase() + " tab",
            classList: "comfyui-button tab-button",
            content: name,
            action: () => {
                tabButtons.forEach((tabButton) => {
                    if (name === tabButton.getAttribute("data-name")) {
                        tabButton.classList.add(ACTIVE_TAB_CLASS);
                    }
                    else {
                        tabButton.classList.remove(ACTIVE_TAB_CLASS);
                    }
                });
                tabContents.forEach((tabContent) => {
                    if (name === tabContent.getAttribute("data-name")) {
                        tabContent.style.display = "";
                    }
                    else {
                        tabContent.style.display = "none";
                    }
                });
            },
        }).element;
        tab.dataset.name = name;
        const content = $el("div.tab-content", {
            dataset: {
                name: data.name,
            }
        }, [
            data.tabContent
        ]);
        tabButtons.push(tab);
        tabContents.push(content);
    });
    
    return [tabButtons, tabContents];
}

/**
 * @param {HTMLDivElement} element
 * @param {Record<string, HTMLDivElement>[]} tabButtons
 */
function GenerateDynamicTabTextCallback(element, tabButtons, minWidth) {
    return () => {
        if (element.style.display === "none") {
            return;
        }
        const managerRect = element.getBoundingClientRect();
        const isIcon = managerRect.width < minWidth; // TODO: `minWidth` is a magic value
        const iconDisplay = isIcon ? "" : "none";
        const spanDisplay = isIcon ? "none" : "";
        tabButtons.forEach((tabButton) => {
            tabButton.getElementsByTagName("i")[0].style.display = iconDisplay;
            tabButton.getElementsByTagName("span")[0].style.display = spanDisplay;
        });
    };
}

/**
 * @param {[String, int][]} map
 * @returns {String}
 */
function TagCountMapToParagraph(map) {
    let text = "<p>";
    for (let i = 0; i < map.length; i++) {
        const v = map[i];
        const tag = v[0];
        const count = v[1];
        text += tag + "<span class=\"no-select\"> (" + count + ")</span>";
        if (i !== map.length - 1) {
            text += ", ";
        }
    }
    text += "</p>";
    return text;
}

/**
 * @param {String} p
 * @returns {[String, int][]}
 */
function ParseTagParagraph(p) {
    return p.split(",").map(x => {
        const text = x.endsWith(", ") ? x.substring(0, x.length - 2) : x;
        const i = text.lastIndexOf("(");
        const tag = text.substring(0, i).trim();
        const frequency = parseInt(text.substring(i + 1, text.length - 1));
        return [tag, frequency];
    });
}

class ImageSelect {
    /** @constant {string} */ #PREVIEW_DEFAULT = "Default";
    /** @constant {string} */ #PREVIEW_UPLOAD = "Upload";
    /** @constant {string} */ #PREVIEW_URL = "URL";
    /** @constant {string} */ #PREVIEW_NONE = "No Preview";
    
    elements = {
        /** @type {HTMLDivElement} */ radioGroup: null,
        /** @type {HTMLDivElement} */ radioButtons: null,
        /** @type {HTMLDivElement} */ previews: null,
        
        /** @type {HTMLImageElement} */ defaultPreviewNoImage: null,
        /** @type {HTMLDivElement} */ defaultPreviews: null,
        /** @type {HTMLDivElement} */ defaultUrl: null,
        
        /** @type {HTMLImageElement} */ customUrlPreview: null,
        /** @type {HTMLInputElement} */ customUrl: null,
        /** @type {HTMLDivElement} */ custom: null,
        
        /** @type {HTMLImageElement} */ uploadPreview: null,
        /** @type {HTMLInputElement} */ uploadFile: null,
        /** @type {HTMLDivElement} */ upload: null,
    };
    
    /** @type {string} */
    #name = null;
    
    /** @returns {Promise<string> | Promise<File>} */
    async getImage() {
        const name = this.#name;
        const value = document.querySelector(`input[name="${name}"]:checked`).value;
        const elements = this.elements;
        switch (value) {
            case this.#PREVIEW_DEFAULT:
                const children = elements.defaultPreviews.children;
                const noImage = PREVIEW_NONE_URI;
                let url = "";
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (child.style.display !== "none" && 
                        child.nodeName === "IMG" && 
                        !child.src.endsWith(noImage)
                    ) {
                        url = child.src;
                    }
                }
                if (url.startsWith(Civitai.imageUrlPrefix())) {
                    url = await Civitai.getFullSizeImageUrl(url).catch((err) => {
                        console.warn(err);
                        return url;
                    });
                }
                return url;
            case this.#PREVIEW_URL:
                const value = elements.customUrl.value;
                if (value.startsWith(Civitai.imagePostUrlPrefix())) {
                    try {
                        const imageInfo = await Civitai.getImageInfo(value);
                        const items = imageInfo["items"];
                        if (items.length === 0) {
                            console.warn("Civitai /api/v1/images returned 0 items.");
                            return value;
                        }
                        return items[0]["url"];
                    }
                    catch (error) {
                        console.error("Failed to get image info from Civitai!", error);
                        return value;
                    }
                }
                return value;
            case this.#PREVIEW_UPLOAD:
                return elements.uploadFile.files[0] ?? "";
            case this.#PREVIEW_NONE:
                return PREVIEW_NONE_URI;
        }
        return "";
    }
    
    /** @returns {void} */
    resetModelInfoPreview() {
        let noimage = this.elements.defaultUrl.dataset.noimage;
        [
            this.elements.defaultPreviewNoImage,
            this.elements.defaultPreviews,
            this.elements.customUrlPreview,
            this.elements.uploadPreview,
        ].forEach((el) => {
            el.style.display = "none";
            if (this.elements.defaultPreviewNoImage !== el) {
                if (el.nodeName === "IMG") {
                    el.src = noimage;
                }
                else {
                    el.children[0].src = noimage;
                }
            }
            else {
                el.src = PREVIEW_NONE_URI;
            }
        });
        this.checkDefault();
        this.elements.uploadFile.value = "";
        this.elements.customUrl.value = "";
        this.elements.upload.style.display = "none";
        this.elements.custom.style.display = "none";
    }
    
    /** @returns {boolean} */
    defaultIsChecked() {
        const children = this.elements.radioButtons.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const radioButton = child.children[0];
            if (radioButton.value === this.#PREVIEW_DEFAULT) {
                return radioButton.checked;
            }
        };
        return false;
    }
    
    /** @returns {void} */
    checkDefault() {
        const children = this.elements.radioButtons.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const radioButton = child.children[0];
            if (radioButton.value === this.#PREVIEW_DEFAULT) {
                this.elements.defaultPreviews.style.display = "block";
                radioButton.checked = true;
                break;
            }
        };
    }
    
    /**
     * @param {1 | -1} step 
     */
    stepDefaultPreviews(step) {
        const children = this.elements.defaultPreviews.children;
        if (children.length === 0) {
            return;
        }
        let currentIndex = -step;
        for (let i = 0; i < children.length; i++) {
            const previewImage = children[i];
            const display = previewImage.style.display;
            if (display !== "none") {
                currentIndex = i;
            }
            previewImage.style.display = "none";
        }
        currentIndex = currentIndex + step;
        if (currentIndex >= children.length) { currentIndex = 0; }
        else if (currentIndex < 0) { currentIndex = children.length - 1; }
        children[currentIndex].style.display = "block";
    }
    
    /**
     * @param {string} radioGroupName - Should be unique for every radio group.
     * @param {string[]|undefined} defaultPreviews
     */
    constructor(radioGroupName, defaultPreviews = []) {
        if (defaultPreviews === undefined | defaultPreviews === null | defaultPreviews.length === 0) {
            defaultPreviews = [PREVIEW_NONE_URI];
        }
        this.#name = radioGroupName;
        
        const el_defaultUri = $el("div", {
            $: (el) => (this.elements.defaultUrl = el),
            style: { display: "none" },
            "data-noimage": PREVIEW_NONE_URI,
        });
        
        const el_defaultPreviewNoImage = $el("img", {
            $: (el) => (this.elements.defaultPreviewNoImage = el),
            loading: "lazy", /* `loading` BEFORE `src`; Known bug in Firefox 124.0.2 and Safari for iOS 17.4.1 (https://stackoverflow.com/a/76252772) */
            src: PREVIEW_NONE_URI,
            style: { display: "none" },
        });
        
        const el_defaultPreviews = $el("div", {
            $: (el) => (this.elements.defaultPreviews = el),
            style: {
                width: "100%",
                height: "100%",
            },
        }, (() => {
            const imgs = defaultPreviews.map((url) => {
                return $el("img", {
                    loading: "lazy", /* `loading` BEFORE `src`; Known bug in Firefox 124.0.2 and Safari for iOS 17.4.1 (https://stackoverflow.com/a/76252772) */
                    src: url,
                    style: { display: "none" },
                    onerror: (e) => {
                        e.target.src = el_defaultUri.dataset.noimage ?? PREVIEW_NONE_URI;
                    },
                });
            });
            if (imgs.length > 0) {
                imgs[0].style.display = "block";
            }
            return imgs;
        })());
        
        const el_uploadPreview = $el("img", {
            $: (el) => (this.elements.uploadPreview = el),
            src: PREVIEW_NONE_URI,
            style: { display : "none" },
            onerror: (e) => {
                e.target.src = el_defaultUri.dataset.noimage ?? PREVIEW_NONE_URI;
            },
        });
        const el_uploadFile = $el("input", {
            $: (el) => (this.elements.uploadFile = el),
            type: "file",
            name: "upload preview image",
            accept: IMAGE_EXTENSIONS.join(", "),
            onchange: (e) => {
                const file = e.target.files[0];
                if (file) {
                    el_uploadPreview.src = URL.createObjectURL(file);
                }
                else {
                    el_uploadPreview.src = el_defaultUri.dataset.noimage;
                }
            },
        });
        const el_upload = $el("div.row.tab-header-flex-block", {
            $: (el) => (this.elements.upload = el),
            style: { display: "none" },
        }, [
            el_uploadFile,
        ]);
        
        /**
         * @param {string} url 
         * @returns {Promise<string>}
         */
        const getCustomPreviewUrl = async (url) => {
            if (url.startsWith(Civitai.imagePostUrlPrefix())) {
                return await Civitai.getImageInfo(url)
                .then((imageInfo) => {
                    const items = imageInfo["items"];
                    if (items.length > 0) {
                        return items[0]["url"];
                    }
                    else {
                        console.warn("Civitai /api/v1/images returned 0 items.");
                        return url;
                    }
                })
                .catch((error) => {
                    console.error("Failed to get image info from Civitai!", error);
                    return url;
                });
            }
            else {
                return url;
            }
        };
        
        const el_customUrlPreview = $el("img", {
            $: (el) => (this.elements.customUrlPreview = el),
            src: PREVIEW_NONE_URI,
            style: { display: "none" },
            onerror: (e) => {
                e.target.src = el_defaultUri.dataset.noimage ?? PREVIEW_NONE_URI;
            },
        });
        const el_customUrl = $el("input.search-text-area", {
            $: (el) => (this.elements.customUrl = el),
            type: "text",
            name: "custom preview image url",
            autocomplete: "off",
            placeholder: "https://custom-image-preview.png",
            onkeydown: async (e) => {
                if (e.key === "Enter") {
                    const value = e.target.value;
                    el_customUrlPreview.src = await getCustomPreviewUrl(value);
                    e.stopPropagation();
                    e.target.blur();
                }
            },
        });
        const el_custom = $el("div.row.tab-header-flex-block", {
            $: (el) => (this.elements.custom = el),
            style: { display: "none" },
        }, [
            el_customUrl,
            new ComfyButton({
                icon: "magnify",
                tooltip: "Search models",
                classList: "comfyui-button icon-button",
                action: async (e) => {
                    const [button, icon, span] = comfyButtonDisambiguate(e.target);
                    button.disabled = true;
                    const value = el_customUrl.value;
                    el_customUrlPreview.src = await getCustomPreviewUrl(value);
                    e.stopPropagation();
                    el_customUrl.blur();
                    button.disabled = false;
                },
            }).element,
        ]);
        
        const el_previewButtons = $el("div.model-preview-overlay", {
            style: {
                display: el_defaultPreviews.children.length > 1 ? "block" : "none",
            },
        }, [
            new ComfyButton({
                icon: "arrow-left",
                tooltip: "Previous image",
                classList: "comfyui-button icon-button model-preview-button-left",
                action: () => this.stepDefaultPreviews(-1),
            }).element,
            new ComfyButton({
                icon: "arrow-right",
                tooltip: "Next image",
                classList: "comfyui-button icon-button model-preview-button-right",
                action: () => this.stepDefaultPreviews(1),
            }).element,
        ]);
        const el_previews = $el("div.item", {
            $: (el) => (this.elements.previews = el),
        }, [
            $el("div", {
                    style: {
                        "width": "100%",
                        "height": "100%",
                    },
                }, 
                [
                    el_defaultPreviewNoImage,
                    el_defaultPreviews,
                    el_customUrlPreview,
                    el_uploadPreview,
                ],
            ),
            el_previewButtons,
        ]);
        
        const el_radioButtons = $radioGroup({
            name: radioGroupName,
            onchange: (value) => {
                el_custom.style.display = "none";
                el_upload.style.display = "none";
                
                el_defaultPreviews.style.display = "none";
                el_previewButtons.style.display = "none";
                
                el_defaultPreviewNoImage.style.display = "none";
                el_uploadPreview.style.display = "none";
                el_customUrlPreview.style.display = "none";
                
                switch (value) {
                    case this.#PREVIEW_DEFAULT:
                        el_defaultPreviews.style.display = "block";
                        el_previewButtons.style.display = el_defaultPreviews.children.length > 1 ? "block" : "none";
                        break;
                    case this.#PREVIEW_UPLOAD:
                        el_upload.style.display = "flex";
                        el_uploadPreview.style.display = "block";
                        break;
                    case this.#PREVIEW_URL:
                        el_custom.style.display = "flex";
                        el_customUrlPreview.style.display = "block";
                        break;
                    case this.#PREVIEW_NONE:
                    default:
                        el_defaultPreviewNoImage.style.display = "block";
                        break;
                }
            },
            options: [
                this.#PREVIEW_DEFAULT,
                this.#PREVIEW_URL,
                this.#PREVIEW_UPLOAD,
                this.#PREVIEW_NONE,
            ].map((value) => {
                return { value: value, };
            }),
        });
        this.elements.radioButtons = el_radioButtons;
        
        const children = el_radioButtons.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const radioButton = child.children[0];
            if (radioButton.value === this.#PREVIEW_DEFAULT) {
                radioButton.checked = true;
                break;
            }
        };
        
        const el_radioGroup = $el("div.model-preview-select-radio-container", {
            $: (el) => (this.elements.radioGroup = el),
        }, [
            $el("div.row.tab-header-flex-block", [el_radioButtons]),
            $el("div.model-preview-select-radio-inputs", [
                el_custom,
                el_upload,
            ]),
        ]);
    }
}

/**
 * @typedef {Object} DirectoryItem 
 * @property {String} name
 * @property {number | undefined} childCount
 * @property {number | undefined} childIndex
 */

class ModelDirectories {
    /** @type {DirectoryItem[]} */
    data = [];

    /**
     * @returns {number}
     */
    rootIndex() {
        return 0;
    }

    /**
     * @param {any} index
     * @returns {boolean}
     */
    isValidIndex(index) {
        return typeof index === "number" && 0 <= index && index < this.data.length;
    }

    /**
     * @param {number} index
     * @returns {DirectoryItem}
     */
    getItem(index) {
        if (!this.isValidIndex(index)) {
            throw new Error(`Index '${index}' is not valid!`);
        }
        return this.data[index];
    }

    /**
     * @param {DirectoryItem | number} item
     * @returns {boolean}
     */
    isDirectory(item) {
        if (typeof item === "number") {
            item = this.getItem(item);
        }
        const childCount = item.childCount;
        return childCount !== undefined && childCount != null;
    }

    /**
     * @param {DirectoryItem | number} item
     * @returns {boolean}
     */
    isEmpty(item) {
        if (typeof item === "number") {
            item = this.getItem(item);
        }
        if (!this.isDirectory(item)) {
            throw new Error("Item is not a directory!");
        }
        return item.childCount === 0;
    }

    /**
     * Returns a slice of children from the directory list.
     * @param {DirectoryItem | number} item
     * @returns {DirectoryItem[]}
     */
    getChildren(item) {
        if (typeof item === "number") {
            item = this.getItem(item);
            if (!this.isDirectory(item)) {
                throw new Error("Item is not a directory!");
            }
        }
        else if (!this.isDirectory(item)) {
            throw new Error("Item is not a directory!");
        }
        const count = item.childCount;
        const index = item.childIndex;
        return this.data.slice(index, index + count);
    }

    /**
     * Returns index of child in parent directory. Returns -1 if DNE.
     * @param {DirectoryItem | number} parent
     * @param {string} name
     * @returns {number}
     */
    findChildIndex(parent, name) {
        const item = this.getItem(parent);
        if (!this.isDirectory(item)) {
            throw new Error("Item is not a directory!");
        }
        const start = item.childIndex;
        const children = this.getChildren(item);
        const index = children.findIndex((item) => {
            return item.name === name;
        });
        if (index === -1) {
            return -1;
        }
        return index + start;
    }
    
    /**
     * Returns a list of matching search results and valid path.
     * @param {string} filter
     * @param {string} searchSeparator
     * @param {boolean} directoriesOnly
     * @returns {[string[], string]}
     */
    search(filter, searchSeparator, directoriesOnly) {
        let cwd = this.rootIndex();
        let indexLastWord = 1;
        while (true) {
            const indexNextWord = filter.indexOf(searchSeparator, indexLastWord);
            if (indexNextWord === -1) {
                // end of filter
                break;
            }

            const item = this.getItem(cwd);
            if (!this.isDirectory(item) || this.isEmpty(item)) {
                break;
            }

            const word = filter.substring(indexLastWord, indexNextWord);
            cwd = this.findChildIndex(cwd, word);
            if (!this.isValidIndex(cwd)) {
                return [[], ""];
            }
            indexLastWord = indexNextWord + 1;
        }
        //const cwdPath = filter.substring(0, indexLastWord);

        const lastWord = filter.substring(indexLastWord);
        const children = this.getChildren(cwd);
        if (directoriesOnly) {
            let indexPathEnd = indexLastWord;
            const results = children.filter((child) => {
                return (
                    this.isDirectory(child) && 
                    child.name.startsWith(lastWord)
                );
            }).map((directory) => {
                const children = this.getChildren(directory);
                const hasChildren = children.some((item) => {
                    return this.isDirectory(item);
                });
                const suffix = hasChildren ? searchSeparator : "";
                //const suffix = searchSeparator;
                if (directory.name == lastWord) {
                    indexPathEnd += searchSeparator.length + directory.name.length + 1;
                }
                return directory.name + suffix;
            });
            const path = filter.substring(0, indexPathEnd);
            return [results, path];
        }
        else {
            let indexPathEnd = indexLastWord;
            const results = children.filter((child) => {
                return child.name.startsWith(lastWord);
            }).map((item) => {
                const isDir = this.isDirectory(item);
                const isNonEmptyDirectory = isDir && item.childCount > 0;
                const suffix = isNonEmptyDirectory  ? searchSeparator : "";
                //const suffix = isDir  ? searchSeparator : "";
                if (!isDir && item.name == lastWord) {
                    indexPathEnd += searchSeparator.length + item.name.length + 1;
                }
                return item.name + suffix;
            });
            const path = filter.substring(0, indexPathEnd);
            return [results, path];
        }
    }
}

const DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS = "search-directory-dropdown-key-selected";
const DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS = "search-directory-dropdown-mouse-selected";


class ModelData {
    /** @type {string} */
    searchSeparator = "/"; // TODO: other client or server code may be assuming this to always be "/"
    
    /** @type {string} */
    systemSeparator = null;
    
    /** @type {Object} */
    models = {};
    
    /** @type {ModelDirectories} */
    directories = null;
    
    constructor() {
        this.directories = new ModelDirectories();
    }
}

class DirectoryDropdown {
    /** @type {HTMLDivElement} */
    element = null;
    
    /** @type {Boolean} */
    showDirectoriesOnly = false;
    
    /** @type {HTMLInputElement} */
    #input = null;
    
    /** @type {() => string} */
    #getModelType = null;
    
    /** @type {ModelData} */
    #modelData = null; // READ ONLY
    
    /** @type {() => void} */
    #updateCallback = null;
    
    /** @type {() => Promise<void>} */
    #submitCallback = null;
    
    /** @type {string} */
    #deepestPreviousPath = "/";
    
    /** @type {Any} */
    #touchSelectionStart = null;
    
    /**
     * @param {ModelData} modelData
     * @param {HTMLInputElement} input
     * @param {Boolean} [showDirectoriesOnly=false]
     * @param {() => string} [getModelType= () => { return ""; }]
     * @param {() => void} [updateCallback= () => {}]
     * @param {() => Promise<void>} [submitCallback= () => {}]
     * @param {() => Boolean} [isDynamicSearch= () => { return false; }]
     */
    constructor(modelData, input, showDirectoriesOnly = false, getModelType = () => { return ""; }, updateCallback = () => {}, submitCallback = () => {}, isDynamicSearch = () => { return false; }) {
        /** @type {HTMLDivElement} */
        const dropdown = $el("div.search-directory-dropdown", {
            style: {
                display: "none",
            },
        });
        this.element = dropdown;
        this.#modelData = modelData;
        this.#input = input;
        this.#getModelType = getModelType;
        this.#updateCallback = updateCallback;
        this.#submitCallback = submitCallback;
        this.showDirectoriesOnly = showDirectoriesOnly;
        
        input.addEventListener("input", async(e) => {
            const path = this.#updateOptions();
            if (path !== undefined) {
                this.#restoreSelectedOption(path);
                this.#updateDeepestPath(path);
            }
            updateCallback();
            if (isDynamicSearch()) {
                await submitCallback();
            }
        });
        input.addEventListener("focus", () => {
            const path = this.#updateOptions();
            if (path !== undefined) {
                this.#deepestPreviousPath = path;
                this.#restoreSelectedOption(path);
            }
            updateCallback();
        });
        input.addEventListener("blur", () => { dropdown.style.display = "none"; });
        input.addEventListener("keydown", async(e) => {
                const options = dropdown.children;
                let iSelection;
                for (iSelection = 0; iSelection < options.length; iSelection++) {
                    const selection = options[iSelection];
                    if (selection.classList.contains(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS)) {
                        break;
                    }
                }
                if (e.key === "Escape") {
                    e.stopPropagation();
                    if (iSelection < options.length) {
                        const selection = options[iSelection];
                        selection.classList.remove(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                    }
                    else {
                        e.target.blur();
                    }
                }
                else if (e.key === "ArrowRight" && dropdown.style.display !== "none") {
                    const selection = options[iSelection];
                    if (selection !== undefined && selection !== null) {
                        e.stopPropagation();
                        e.preventDefault(); // prevent cursor move
                        const input = e.target;
                        const searchSeparator = modelData.searchSeparator;
                        DirectoryDropdown.selectionToInput(
                            input, 
                            selection, 
                            searchSeparator, 
                            DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS
                        );
                        const path = this.#updateOptions();
                        if (path !== undefined) {
                            this.#restoreSelectedOption(path);
                            this.#updateDeepestPath(path);
                        }
                        updateCallback();
                        if (isDynamicSearch()) {
                            await submitCallback();
                        }
                    }
                }
                else if (e.key === "ArrowLeft" && dropdown.style.display !== "none") {
                    const input = e.target;
                    const oldFilterText = input.value;
                    const searchSeparator = modelData.searchSeparator;
                    const iSep = oldFilterText.lastIndexOf(searchSeparator, oldFilterText.length - 2);
                    const newFilterText = oldFilterText.substring(0, iSep + 1);
                    if (oldFilterText !== newFilterText) {
                        const delta = oldFilterText.substring(iSep + 1);
                        let isMatch = delta[delta.length-1] === searchSeparator;
                        if (!isMatch) {
                            const options = dropdown.children;
                            for (let i = 0; i < options.length; i++) {
                                const option = options[i];
                                if (option.innerText.startsWith(delta)) {
                                    isMatch = true;
                                    break;
                                }
                            }
                        }
                        if (isMatch) {
                            e.stopPropagation();
                            e.preventDefault(); // prevent cursor move
                            input.value = newFilterText;
                            const path = this.#updateOptions();
                            if (path !== undefined) {
                                this.#restoreSelectedOption(path);
                                this.#updateDeepestPath(path);
                            }
                            updateCallback();
                            if (isDynamicSearch()) {
                                await submitCallback();
                            }
                        }
                    }
                }
                else if (e.key === "Enter") {
                    e.stopPropagation();
                    const input = e.target;
                    if (dropdown.style.display !== "none") {
                        const selection = options[iSelection];
                        if (selection !== undefined && selection !== null) {
                            DirectoryDropdown.selectionToInput(
                                input, 
                                selection, 
                                modelData.searchSeparator, 
                                DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS
                            );
                            const path = this.#updateOptions();
                            if (path !== undefined) {
                                this.#updateDeepestPath(path);
                            }
                            updateCallback();
                        }
                    }
                    await submitCallback();
                    input.blur();
                }
                else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && dropdown.style.display !== "none") {
                    e.stopPropagation();
                    e.preventDefault(); // prevent cursor move
                    let iNext = options.length;
                    if (iSelection < options.length) {
                        const selection = options[iSelection];
                        selection.classList.remove(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                        const delta = e.key === "ArrowDown" ? 1 : -1;
                        iNext = iSelection + delta;
                        if (iNext < 0) {
                            iNext = options.length - 1;
                        }
                        else if (iNext >= options.length) {
                            iNext = 0;
                        }
                        const selectionNext = options[iNext];
                        selectionNext.classList.add(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                    }
                    else if (iSelection === options.length) { // none
                        iNext = e.key === "ArrowDown" ? 0 : options.length-1;
                        const selection = options[iNext];
                        selection.classList.add(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                    }
                    if (0 <= iNext && iNext < options.length) {
                        DirectoryDropdown.#clampDropdownScrollTop(dropdown, options[iNext]);
                    }
                    else {
                        dropdown.scrollTop = 0;
                        const options = dropdown.children;
                        for (iSelection = 0; iSelection < options.length; iSelection++) {
                            const selection = options[iSelection];
                            if (selection.classList.contains(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS)) {
                                selection.classList.remove(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                            }
                        }
                    }
                }
            },
        );
    }
    
    /**
     * @param {HTMLInputElement} input
     * @param {HTMLParagraphElement | undefined | null} selection
     * @param {String} searchSeparator
     * @param {String} className
     * @returns {boolean} changed
     */
    static selectionToInput(input, selection, searchSeparator, className) {
        selection.classList.remove(className);
        const selectedText = selection.innerText;
        const oldFilterText = input.value;
        const iSep = oldFilterText.lastIndexOf(searchSeparator);
        const previousPath = oldFilterText.substring(0, iSep + 1);
        const newFilterText = previousPath + selectedText;
        input.value = newFilterText;
        return newFilterText !== oldFilterText;
    }

    /**
     * @param {string} path
     */
    #updateDeepestPath = (path) => {
        const deepestPath = this.#deepestPreviousPath;
        if (path.length > deepestPath.length || !deepestPath.startsWith(path)) {
            this.#deepestPreviousPath = path;
        }
    };

    /**
         * @param {HTMLDivElement} dropdown
         * @param {HTMLParagraphElement} selection
         */
    static #clampDropdownScrollTop = (dropdown, selection) => {
        let dropdownTop = dropdown.scrollTop;
        const dropdownHeight = dropdown.offsetHeight;
        const selectionHeight = selection.offsetHeight;
        const selectionTop = selection.offsetTop;
        dropdownTop = Math.max(dropdownTop, selectionTop - dropdownHeight + selectionHeight);
        dropdownTop = Math.min(dropdownTop, selectionTop);
        dropdown.scrollTop = dropdownTop;
    };

    /**
     * @param {string} path
     */
    #restoreSelectedOption(path) {
        const searchSeparator = this.#modelData.searchSeparator;
        const deepest = this.#deepestPreviousPath;
        if (deepest.length >= path.length && deepest.startsWith(path)) {
            let name = deepest.substring(path.length);
            name = removePrefix(name, searchSeparator);
            const i1 = name.indexOf(searchSeparator);
            if (i1 !== -1) {
                name = name.substring(0, i1);
            }
            
            const dropdown = this.element;
            const options = dropdown.children;
            let iSelection;
            for (iSelection = 0; iSelection < options.length; iSelection++) {
                const selection = options[iSelection];
                let text = removeSuffix(selection.innerText, searchSeparator);
                if (text === name) {
                    selection.classList.add(DROPDOWN_DIRECTORY_SELECTION_KEY_CLASS);
                    dropdown.scrollTop = dropdown.scrollHeight; // snap to top
                    DirectoryDropdown.#clampDropdownScrollTop(dropdown, selection);
                    break;
                }
            }
            if (iSelection === options.length) {
                dropdown.scrollTop = 0;
            }
        }
    }

    /**
     * Returns path if update was successful.
     * @returns {string | undefined}
     */
    #updateOptions() {
        const dropdown = this.element;
        const input = this.#input;

        const searchSeparator = this.#modelData.searchSeparator;
        const filter = input.value;
        if (filter[0] !== searchSeparator) {
            dropdown.style.display = "none";
            return undefined;
        }

        const modelType = this.#getModelType();
        const searchPrefix = modelType !== "" ? searchSeparator + modelType : "";
        const directories = this.#modelData.directories;
        const [options, path] = directories.search(
            searchPrefix + filter,
            searchSeparator,
            this.showDirectoriesOnly,
        );
        if (options.length === 0) {
            dropdown.style.display = "none";
            return undefined;
        }

        const mouse_selection_select = (e) => {
            const selection = e.target;
            if (e.movementX === 0 && e.movementY === 0) { return; }
            if (!selection.classList.contains(DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS)) {
                // assumes only one will ever selected at a time
                e.stopPropagation();
                const children = dropdown.children;
                for (let iChild = 0; iChild < children.length; iChild++) {
                    const child = children[iChild];
                    child.classList.remove(DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS);
                }
                selection.classList.add(DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS);
            }
        };
        const mouse_selection_deselect = (e) => {
            e.stopPropagation();
            e.target.classList.remove(DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS);
        };
        const selection_submit = async(e) => {
            e.stopPropagation();
            e.preventDefault();
            const selection = e.target;
            const changed = DirectoryDropdown.selectionToInput(
                input, 
                selection, 
                searchSeparator, 
                DROPDOWN_DIRECTORY_SELECTION_MOUSE_CLASS
            );
            if (!changed) {
                dropdown.style.display = "none";
                input.blur();
            }
            else {
                const path = this.#updateOptions(); // TODO: is this needed?
                if (path !== undefined) {
                    this.#updateDeepestPath(path);
                }
            }
            this.#updateCallback();
        };
        const touch_selection_select = async(e) => {
            const [startX, startY] = this.#touchSelectionStart;
            const [endX, endY] = [
                e.changedTouches[0].clientX,
                e.changedTouches[0].clientY
            ];
            if (startX === endX && startY === endY) {
                const touch = e.changedTouches[0];
                const box = dropdown.getBoundingClientRect();
                if (touch.clientX >= box.left &&
                    touch.clientX <= box.right &&
                    touch.clientY >= box.top &&
                    touch.clientY <= box.bottom) {
                    selection_submit(e);
                }
            }
        };
        const touch_start = (e) => {
            this.#touchSelectionStart = [
                e.changedTouches[0].clientX,
                e.changedTouches[0].clientY
            ];
        };
        dropdown.innerHTML = "";
        dropdown.append.apply(dropdown, options.map((text) => {
            /** @type {HTMLParagraphElement} */
            const p = $el(
                "p",
                {
                    onmouseenter: (e) => mouse_selection_select(e),
                    onmousemove: (e) => mouse_selection_select(e),
                    onmouseleave: (e) => mouse_selection_deselect(e),
                    onmousedown: (e) => selection_submit(e),
                    ontouchstart: (e) => touch_start(e),
                    ontouchmove: (e) => touch_move(e),
                    ontouchend: (e) => touch_selection_select(e),
                },
                [
                    text
                ]
            );
            return p;
        }));
        // TODO: handle when dropdown is near the bottom of the window
        const inputRect = input.getBoundingClientRect();
        dropdown.style.width = inputRect.width + "px";
        dropdown.style.top = (input.offsetTop + inputRect.height) + "px";
        dropdown.style.left = input.offsetLeft + "px";
        dropdown.style.display = "block";

        return path;
    }
}

const MODEL_SORT_DATE_CREATED = "dateCreated";
const MODEL_SORT_DATE_MODIFIED = "dateModified";
const MODEL_SORT_SIZE_BYTES = "sizeBytes";
const MODEL_SORT_DATE_NAME = "name";

class ModelGrid {
    /**
     * @param {string} nodeType
     * @returns {int}
     */
    static modelWidgetIndex(nodeType) {
        return nodeType === undefined ? -1 : 0;
    }
    
    /**
     * @param {string} text
     * @param {string} file
     * @param {boolean} removeExtension
     * @returns {string}
     */
    static insertEmbeddingIntoText(text, file, removeExtension) {
        let name = file;
        if (removeExtension) {
            name = SearchPath.splitExtension(name)[0];
        }
        const sep = text.length === 0 || text.slice(-1).match(/\s/) ? "" : " ";
        return text + sep + "(embedding:" +  name  + ":1.0)";
    }
    
    /**
     * @param {Array} list
     * @param {string} searchString
     * @returns {Array}
     */
    static #filter(list, searchString) {
        /** @type {string[]} */
        const keywords = searchString
            //.replace("*", " ") // TODO: this is wrong for wildcards
            .split(/(-?".*?"|[^\s"]+)+/g)
            .map((item) => item
                .trim()
                .replace(/(?:")+/g, "")
                .toLowerCase())
            .filter(Boolean);

        const regexSHA256 = /^[a-f0-9]{64}$/gi;
        const fields = ["name", "path"];
        return list.filter((element) => {
            const text = fields
                .reduce((memo, field) => memo + " " + element[field], "")
                .toLowerCase();
            return keywords.reduce((memo, target) => {
                const excludeTarget = target[0] === "-";
                if (excludeTarget && target.length === 1) { return memo; }
                const filteredTarget = excludeTarget ? target.slice(1) : target;
                if (element["SHA256"] !== undefined && regexSHA256.test(filteredTarget)) {
                    return memo && excludeTarget !== (filteredTarget === element["SHA256"]);
                }
                else {
                    return memo && excludeTarget !== text.includes(filteredTarget);
                }
            }, true);
        });
    }
    
    /**
     * In-place sort. Returns an array alias.
     * @param {Array} list
     * @param {string} sortBy
     * @param {bool} [reverse=false]
     * @returns {Array}
     */
    static #sort(list, sortBy, reverse = false) {
        let compareFn = null;
        switch (sortBy) {
            case MODEL_SORT_DATE_NAME:
                compareFn = (a, b) => { return a[MODEL_SORT_DATE_NAME].localeCompare(b[MODEL_SORT_DATE_NAME]); };
                break;
            case MODEL_SORT_DATE_MODIFIED:
                compareFn = (a, b) => { return b[MODEL_SORT_DATE_MODIFIED] - a[MODEL_SORT_DATE_MODIFIED]; };
                break;
            case MODEL_SORT_DATE_CREATED:
                compareFn = (a, b) => { return b[MODEL_SORT_DATE_CREATED] - a[MODEL_SORT_DATE_CREATED]; };
                break;
            case MODEL_SORT_SIZE_BYTES:
                compareFn = (a, b) => { return b[MODEL_SORT_SIZE_BYTES] - a[MODEL_SORT_SIZE_BYTES]; };
                break;
            default:
                console.warn("Invalid filter sort value: '" + sortBy + "'");
                return list;
        }
        const sorted = list.sort(compareFn);
        return reverse ? sorted.reverse() : sorted;
    }
    
    /**
     * @param {Event} event
     * @param {string} modelType
     * @param {string} path
     * @param {boolean} removeEmbeddingExtension
     * @param {int} addOffset
     */
    static #addModel(event, modelType, path, removeEmbeddingExtension, addOffset) {
        let success = false;
        if (modelType !== "embeddings") {
            const nodeType = modelNodeType[modelType];
            const widgetIndex = ModelGrid.modelWidgetIndex(nodeType);
            let node = LiteGraph.createNode(nodeType, null, []);
            if (widgetIndex !== -1 && node) {
                node.widgets[widgetIndex].value = path;
                const selectedNodes = app.canvas.selected_nodes;
                let isSelectedNode = false;
                for (var i in selectedNodes) {
                    const selectedNode = selectedNodes[i];
                    node.pos[0] = selectedNode.pos[0] + addOffset;
                    node.pos[1] = selectedNode.pos[1] + addOffset;
                    isSelectedNode = true;
                    break;
                }
                if (!isSelectedNode) {
                    const graphMouse = app.canvas.graph_mouse;
                    node.pos[0] = graphMouse[0];
                    node.pos[1] = graphMouse[1];
                }
                app.graph.add(node, {doProcessChange: true});
                app.canvas.selectNode(node);
                success = true;
            }
            event.stopPropagation();
        }
        else if (modelType === "embeddings") {
            const [embeddingDirectory, embeddingFile] = SearchPath.split(path);
            const selectedNodes = app.canvas.selected_nodes;
            for (var i in selectedNodes) {
                const selectedNode = selectedNodes[i];
                const nodeType = modelNodeType[modelType];
                const widgetIndex = ModelGrid.modelWidgetIndex(nodeType);
                const target = selectedNode?.widgets[widgetIndex]?.element;
                if (target && target.type === "textarea") {
                    target.value = ModelGrid.insertEmbeddingIntoText(target.value, embeddingFile, removeEmbeddingExtension);
                    success = true;
                }
            }
            if (!success) {
                console.warn("Try selecting a node before adding the embedding.");
            }
            event.stopPropagation();
        }
        comfyButtonAlert(event.target, success, "mdi-check-bold", "mdi-close-thick");
    }

    static #getWidgetComboIndices(node, value) {
        const widgetIndices = [];
        node?.widgets?.forEach((widget, index) => {
            if (widget.type === "combo" && widget.options.values?.includes(value)) {
                widgetIndices.push(index);
            }
        });
        return widgetIndices;
    }

    /**
     * @param {Event} event
     * @param {string} modelType
     * @param {string} path
     * @param {boolean} removeEmbeddingExtension
     * @param {boolean} strictlyOnWidget
     */
    static #dragAddModel(event, modelType, path, removeEmbeddingExtension, strictlyOnWidget) {
        const target = document.elementFromPoint(event.x, event.y);
        if (modelType !== "embeddings" && target.id === "graph-canvas") {
            const pos = app.canvas.convertEventToCanvasOffset(event);
            const node = app.graph.getNodeOnPos(pos[0], pos[1], app.canvas.visible_nodes);

            let widgetIndex = -1;
            if (widgetIndex === -1) {
                const widgetIndices = this.#getWidgetComboIndices(node, path);
                if (widgetIndices.length === 0) {
                    widgetIndex = -1;
                }
                else if (widgetIndices.length === 1) {
                    widgetIndex = widgetIndices[0];
                    if (strictlyOnWidget) {
                        const draggedWidget = app.canvas.processNodeWidgets(node, pos, event);
                        const widget =  node.widgets[widgetIndex];
                        if (draggedWidget != widget) { // != check NOT same object
                            widgetIndex = -1;
                        }
                    }
                }
                else {
                    // ambiguous widget (strictlyOnWidget always true)
                    const draggedWidget = app.canvas.processNodeWidgets(node, pos, event);
                    widgetIndex = widgetIndices.findIndex((index) => {
                        return draggedWidget == node.widgets[index]; // == check same object
                    });
                }
            }

            if (widgetIndex !== -1) {
                node.widgets[widgetIndex].value = path;
                app.canvas.selectNode(node);
            }
            else {
                const expectedNodeType = modelNodeType[modelType];
                const newNode = LiteGraph.createNode(expectedNodeType, null, []);
                let newWidgetIndex = ModelGrid.modelWidgetIndex(expectedNodeType);
                if (newWidgetIndex === -1) {
                    newWidgetIndex = this.#getWidgetComboIndices(newNode, path)[0] ?? -1;
                }
                if (newNode !== undefined && newNode !== null && newWidgetIndex !== -1) {
                    newNode.pos[0] = pos[0];
                    newNode.pos[1] = pos[1];
                    newNode.widgets[newWidgetIndex].value = path;
                    app.graph.add(newNode, {doProcessChange: true});
                    app.canvas.selectNode(newNode);
                }
            }
            event.stopPropagation();
        }
        else if (modelType === "embeddings" && target.type === "textarea") {
            const pos = app.canvas.convertEventToCanvasOffset(event);
            const nodeAtPos = app.graph.getNodeOnPos(pos[0], pos[1], app.canvas.visible_nodes);
            if (nodeAtPos) {
                app.canvas.selectNode(nodeAtPos);
                const [embeddingDirectory, embeddingFile] = SearchPath.split(path);
                target.value = ModelGrid.insertEmbeddingIntoText(target.value, embeddingFile, removeEmbeddingExtension);
                event.stopPropagation();
            }
        }
    }
    
    /**
     * @param {Event} event
     * @param {string} modelType
     * @param {string} path
     * @param {boolean} removeEmbeddingExtension
     */
    static #copyModelToClipboard(event, modelType, path, removeEmbeddingExtension) {
        const nodeType = modelNodeType[modelType];
        let success = false;
        if (nodeType === "Embedding") {
            if (navigator.clipboard){
                const [embeddingDirectory, embeddingFile] = SearchPath.split(path);
                const embeddingText = ModelGrid.insertEmbeddingIntoText("", embeddingFile, removeEmbeddingExtension);
                navigator.clipboard.writeText(embeddingText);
                success = true;
            }
            else {
                console.warn("Cannot copy the embedding to the system clipboard; Try dragging it instead.");
            }
        }
        else if (nodeType) {
            const node = LiteGraph.createNode(nodeType, null, []);
            const widgetIndex = ModelGrid.modelWidgetIndex(nodeType);
            if (widgetIndex !== -1) {
                node.widgets[widgetIndex].value = path;
                app.canvas.copyToClipboard([node]);
                success = true;
            }
        }
        else {
            console.warn(`Unable to copy unknown model type '${modelType}.`);
        }
        comfyButtonAlert(event.target, success, "mdi-check-bold", "mdi-close-thick");
    }
    
    /**
     * @param {Array} models
     * @param {string} modelType
     * @param {Object.<HTMLInputElement>} settingsElements
     * @param {String} searchSeparator
     * @param {String} systemSeparator
     * @param {(searchPath: string) => Promise<void>} showModelInfo
     * @returns {HTMLElement[]}
     */
    static #generateInnerHtml(models, modelType, settingsElements, searchSeparator, systemSeparator, showModelInfo) {
        // TODO: separate text and model logic; getting too messy
        // TODO: fallback on button failure to copy text?
        const canShowButtons = modelNodeType[modelType] !== undefined;
        const showAddButton = canShowButtons && settingsElements["model-show-add-button"].checked;
        const showCopyButton = canShowButtons && settingsElements["model-show-copy-button"].checked;
        const showLoadWorkflowButton = canShowButtons && settingsElements["model-show-load-workflow-button"].checked;
        const strictDragToAdd = settingsElements["model-add-drag-strict-on-field"].checked;
        const addOffset = parseInt(settingsElements["model-add-offset"].value);
        const showModelExtension = settingsElements["model-show-label-extensions"].checked;
        const modelInfoButtonOnLeft = !settingsElements["model-info-button-on-left"].checked;
        const removeEmbeddingExtension = !settingsElements["model-add-embedding-extension"].checked;
        const previewThumbnailFormat = settingsElements["model-preview-thumbnail-type"].value;
        if (models.length > 0) {
            return models.map((item) => {
                const previewInfo = item.preview;
                const previewThumbnail = $el("img.model-preview", {
                    loading: "lazy", /* `loading` BEFORE `src`; Known bug in Firefox 124.0.2 and Safari for iOS 17.4.1 (https://stackoverflow.com/a/76252772) */
                    src: imageUri(
                        previewInfo?.path, 
                        previewInfo?.dateModified, 
                        PREVIEW_THUMBNAIL_WIDTH, 
                        PREVIEW_THUMBNAIL_HEIGHT, 
                        previewThumbnailFormat, 
                    ),
                    draggable: false,
                });
                const searchPath = item.path;
                const path = SearchPath.systemPath(searchPath, searchSeparator, systemSeparator);
                let actionButtons = [];
                if (showAddButton && !(modelType === "embeddings" && !navigator.clipboard)) {
                    actionButtons.push(
                        new ComfyButton({
                            icon: "content-copy",
                            tooltip: "Copy model to clipboard",
                            classList: "comfyui-button icon-button model-button",
                            action: (e) => ModelGrid.#copyModelToClipboard(
                                e, 
                                modelType, 
                                path, 
                                removeEmbeddingExtension,
                            ),
                        }).element,
                    );
                }
                if (showCopyButton) {
                    actionButtons.push(
                        new ComfyButton({
                            icon: "plus-box-outline",
                            tooltip: "Add model to node grid",
                            classList: "comfyui-button icon-button model-button",
                            action: (e) => ModelGrid.#addModel(
                                e, 
                                modelType, 
                                path, 
                                removeEmbeddingExtension, 
                                addOffset, 
                            ),
                        }).element,
                    );
                }
                if (showLoadWorkflowButton) {
                    actionButtons.push(
                        new ComfyButton({
                            icon: "arrow-bottom-left-bold-box-outline",
                            tooltip: "Load preview workflow",
                            classList: "comfyui-button icon-button model-button",
                            action: async (e) => {
                                const urlString = previewThumbnail.src;
                                const url = new URL(urlString);
                                const urlSearchParams = url.searchParams;
                                const uri = urlSearchParams.get("uri");
                                const v = urlSearchParams.get("v");
                                const urlFull = urlString.substring(0, urlString.indexOf("?")) + "?uri=" + uri + "&v=" + v;
                                await loadWorkflow(urlFull);
                            },
                        }).element,
                    );
                }
                const infoButtons = [
                    new ComfyButton({
                        icon: "information-outline",
                        tooltip: "View model information",
                        classList: "comfyui-button icon-button model-button",
                        action: async() => { await showModelInfo(searchPath) },
                    }).element,
                ];
                const dragAdd = (e) => ModelGrid.#dragAddModel(
                    e, 
                    modelType, 
                    path, 
                    removeEmbeddingExtension, 
                    strictDragToAdd
                );
                return $el("div.item", {}, [
                    previewThumbnail,
                    $el("div.model-preview-overlay", {
                        ondragend: (e) => dragAdd(e),
                        draggable: true,
                    }),
                    $el("div.model-preview-top-right", {
                        draggable: false,
                    },
                        modelInfoButtonOnLeft ? infoButtons : actionButtons,
                    ),
                    $el("div.model-preview-top-left", {
                        draggable: false,
                    },
                    modelInfoButtonOnLeft ? actionButtons : infoButtons,
                    ),
                    $el("div.model-label", {
                        draggable: false,
                    }, [
                        $el("p", [showModelExtension ? item.name : SearchPath.splitExtension(item.name)[0]])
                    ]),
                ]);
            });
        } else {
            return [$el("h2", ["No Models"])];
        }
    }
    
    /**
     * @param {HTMLDivElement} modelGrid
     * @param {ModelData} modelData
     * @param {HTMLSelectElement} modelSelect
     * @param {Object.<{value: string}>} previousModelType
     * @param {Object} settings
     * @param {string} sortBy
     * @param {boolean} reverseSort
     * @param {Array} previousModelFilters
     * @param {HTMLInputElement} modelFilter
     * @param {(searchPath: string) => Promise<void>} showModelInfo
     */
    static update(modelGrid, modelData, modelSelect, previousModelType, settings, sortBy, reverseSort, previousModelFilters, modelFilter, showModelInfo) {
        const models = modelData.models;
        let modelType = modelSelect.value;
        if (models[modelType] === undefined) {
            modelType = "checkpoints"; // TODO: magic value
        }

        if (modelType !== previousModelType.value) {
            if (settings["model-persistent-search"].checked) {
                previousModelFilters.splice(0, previousModelFilters.length); // TODO: make sure this actually worked!
            }
            else {
                // cache previous filter text
                previousModelFilters[previousModelType.value] = modelFilter.value;
                // read cached filter text
                modelFilter.value = previousModelFilters[modelType] ?? "";
            }
            previousModelType.value = modelType;
        }

        let modelTypeOptions = [];
        for (const [key, value] of Object.entries(models)) {
            const el = $el("option", [key]);
            modelTypeOptions.push(el);
        }
        modelSelect.innerHTML = "";
        modelTypeOptions.forEach(option => modelSelect.add(option));
        modelSelect.value = modelType;

        const searchAppend = settings["model-search-always-append"].value;
        const searchText = modelFilter.value + " " + searchAppend;
        const modelList = ModelGrid.#filter(models[modelType], searchText);
        ModelGrid.#sort(modelList, sortBy, reverseSort);

        modelGrid.innerHTML = "";
        const modelGridModels = ModelGrid.#generateInnerHtml(
            modelList, 
            modelType, 
            settings, 
            modelData.searchSeparator, 
            modelData.systemSeparator,
            showModelInfo,
        );
        modelGrid.append.apply(modelGrid, modelGridModels);
    }
}

class ModelInfo {
    /** @type {HTMLDivElement} */
    element = null;
    
    elements = {
        /** @type {HTMLDivElement[]} */ tabButtons: null,
        /** @type {HTMLDivElement[]} */ tabContents: null,
        /** @type {HTMLDivElement} */ info: null,
        /** @type {HTMLTextAreaElement} */ notes: null,
        /** @type {HTMLButtonElement} */ setPreviewButton: null,
        /** @type {HTMLInputElement} */  moveDestinationInput: null,
    };
    
    /** @type {ImageSelect} */
    previewSelect = null;
    
    /** @type {string} */
    #savedNotesValue = null;
    
    /** @type {[HTMLElement][]} */
    #settingsElements = null;
    
    /**
     * @param {ModelData} modelData
     * @param {() => Promise<void>} updateModels
     * @param {any} settingsElements
     */
    constructor(modelData, updateModels, settingsElements) {
        this.#settingsElements = settingsElements;
        const moveDestinationInput = $el("input.search-text-area", {
            name: "move directory",
            autocomplete: "off",
            placeholder: modelData.searchSeparator,
            value: modelData.searchSeparator,
        });
        this.elements.moveDestinationInput = moveDestinationInput;
        
        const searchDropdown = new DirectoryDropdown(
            modelData,
            moveDestinationInput,
            true,
        );
        
        const previewSelect = new ImageSelect("model-info-preview-model-FYUIKMNVB");
        this.previewSelect = previewSelect;
        previewSelect.elements.previews.style.display = "flex";
        
        const setPreviewButton = new ComfyButton({
            tooltip: "Overwrite currrent preview with selected image",
            content: "Set as Preview",
            action: async(e) => {
                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                button.disabled = true;
                const confirmation = window.confirm("Change preview image(s) PERMANENTLY?");
                let updatedPreview = false;
                if (confirmation) {
                    const container = this.elements.info;
                    const path = container.dataset.path;
                    const imageUrl = await previewSelect.getImage();
                    if (imageUrl === PREVIEW_NONE_URI) {
                        const encodedPath = encodeURIComponent(path);
                        updatedPreview = await request(
                            `/model-manager/preview/delete?path=${encodedPath}`,
                            {
                                method: "POST",
                                body: JSON.stringify({}),
                            }
                        )
                        .then((result) => {
                            const message = result["alert"];
                            if (message !== undefined) {
                                window.alert(message);
                            }
                            return result["success"];
                        })
                        .catch((err) => {
                            return false;
                        });
                    }
                    else {
                        const formData = new FormData();
                        formData.append("path", path);
                        const image = imageUrl[0] == "/" ? "" : imageUrl;
                        formData.append("image", image);
                        updatedPreview = await request(
                            `/model-manager/preview/set`,
                            {
                                method: "POST",
                                body: formData,
                            }
                        )
                        .then((result) => {
                            const message = result["alert"];
                            if (message !== undefined) {
                                window.alert(message);
                            }
                            return result["success"];
                        })
                        .catch((err) => {
                            return false;
                        });
                    }
                    if (updatedPreview) {
                        updateModels();
                        const previewSelect = this.previewSelect;
                        previewSelect.elements.defaultUrl.dataset.noimage = PREVIEW_NONE_URI;
                        previewSelect.resetModelInfoPreview();
                        this.element.style.display = "none";
                    }
                }
                comfyButtonAlert(e.target, updatedPreview);
                button.disabled = false;
            },
        }).element;
        this.elements.setPreviewButton = setPreviewButton;
        previewSelect.elements.radioButtons.addEventListener("change", (e) => {
            setPreviewButton.style.display = previewSelect.defaultIsChecked() ? "none" : "block";
        });
        
        this.element = $el("div.model-info-view", {
            style: { display: "none" },
        }, [
            $el("div.row.tab-header", {
                display: "block",
            }, [
                $el("div.row.tab-header-flex-block", [
                    new ComfyButton({
                        icon: "trash-can-outline",
                        tooltip: "Delete model FOREVER",
                        classList: "comfyui-button icon-button",
                        action: async(e) => {
                            const [button, icon, span] = comfyButtonDisambiguate(e.target);
                            button.disabled = true;
                            const affirmation = "delete";
                            const confirmation = window.prompt("Type \"" + affirmation + "\" to delete the model PERMANENTLY.\n\nThis includes all image or text files.");
                            let deleted = false;
                            if (confirmation === affirmation) {
                                const container = this.elements.info;
                                const path = encodeURIComponent(container.dataset.path);
                                deleted = await request(
                                    `/model-manager/model/delete?path=${path}`,
                                    {
                                        method: "POST",
                                    }
                                )
                                .then((result) => {
                                    const deleted = result["success"];
                                    const message = result["alert"];
                                    if (message !== undefined) {
                                        window.alert(message);
                                    }
                                    if (deleted)
                                    {
                                        container.innerHTML = "";
                                        this.element.style.display = "none";
                                        updateModels();
                                    }
                                    return deleted;
                                })
                                .catch((err) => {
                                    return false;
                                });
                            }
                            if (!deleted) {
                                comfyButtonAlert(e.target, false);
                            }
                            button.disabled = false;
                        },
                    }).element,
                    $el("div.search-models", [
                        moveDestinationInput,
                        searchDropdown.element,
                    ]),
                    new ComfyButton({
                        icon: "file-move-outline",
                        tooltip: "Move file",
                        action: async(e) => {
                            const [button, icon, span] = comfyButtonDisambiguate(e.target);
                            button.disabled = true;
                            const confirmation = window.confirm("Move this file?");
                            let moved = false;
                            if (confirmation) {
                                const container = this.elements.info;
                                const oldFile = container.dataset.path;
                                const [oldFilePath, oldFileName] = SearchPath.split(oldFile);
                                const newFile = (
                                    moveDestinationInput.value + 
                                    modelData.searchSeparator + 
                                    oldFileName
                                );
                                moved = await request(
                                    `/model-manager/model/move`,
                                    {
                                        method: "POST",
                                        body: JSON.stringify({
                                            "oldFile": oldFile,
                                            "newFile": newFile,
                                        }),
                                    }
                                )
                                .then((result) => {
                                    const moved = result["success"];
                                    const message = result["alert"];
                                    if (message !== undefined) {
                                        window.alert(message);
                                    }
                                    if (moved)
                                    {
                                        moveDestinationInput.value = "";
                                        container.innerHTML = "";
                                        this.element.style.display = "none";
                                        updateModels();
                                    }
                                    return moved;
                                })
                                .catch(err => {
                                    return false;
                                });
                            }
                            comfyButtonAlert(e.target, moved);
                            button.disabled = false;
                        },
                    }).element,
                ]),
            ]),
            $el("div.model-info-container", {
                $: (el) => (this.elements.info = el),
                "data-path": "",
            }),
        ]);
        
        [this.elements.tabButtons, this.elements.tabContents] = GenerateTabGroup([
            { name: "Overview", icon: "information-box-outline", tabContent: this.element },
            { name: "Metadata", icon: "file-document-outline", tabContent: $el("div", ["Metadata"]) },
            { name: "Tags", icon: "tag-outline", tabContent: $el("div", ["Tags"]) },
            { name: "Notes", icon: "pencil-outline", tabContent: $el("div", ["Notes"]) },
        ]);
    }
    
    /** @returns {void} */
    show() {
        this.element.style = "";
        this.element.scrollTop = 0;
    }
    
    /**
     * @param {boolean}
     * @returns {Promise<boolean>}
     */
    async trySave(promptUser) {
        if (this.element.style.display === "none") {
            return true;
        }
        
        const noteValue = this.elements.notes.value;
        const savedNotesValue = this.#savedNotesValue;
        if (noteValue.trim() === savedNotesValue.trim()) {
            return true;
        }
        const saveChanges = !promptUser || window.confirm("Save notes?");
        if (saveChanges) {
            const path = this.elements.info.dataset.path;
            const saved = await saveNotes(path, noteValue);
            if (!saved) {
                window.alert("Failed to save notes!");
                return false;
            }
            this.#savedNotesValue = noteValue;
        }
        else {
            const discardChanges = window.confirm("Discard changes?");
            if (!discardChanges) {
                return false;
            }
            else {
                this.elements.notes.value = savedNotesValue;
            }
        }
        return true;
    }
    
    /**
     * @param {boolean?} promptSave
     * @returns {Promise<boolean>}
     */
    async tryHide(promptSave = true) {
        const notes = this.elements.notes;
        if (promptSave && notes !== undefined && notes !== null) {
            const saved = await this.trySave(promptSave);
            if (!saved) {
                return false;
            }
            this.#savedNotesValue = "";
            this.elements.notes.value = "";
        }
        this.element.style.display = "none";
        return true;
    }
    
    /**
     * @param {string} searchPath
     * @param {() => Promise<void>} updateModels
     * @param {string} searchSeparator
     */
    async update(searchPath, updateModels, searchSeparator) {
        const path = encodeURIComponent(searchPath);
        const [info, metadata, tags, noteText] = await request(`/model-manager/model/info?path=${path}`)
            .then((result) => {
                const success = result["success"];
                const message = result["alert"];
                if (message !== undefined) {
                    window.alert(message);
                }
                if (!success) {
                    return undefined;
                }
                return [
                    result["info"], 
                    result["metadata"], 
                    result["tags"], 
                    result["notes"]
                ];
            })
            .catch((err) => {
                console.log(err);
                return undefined;
            }
        );
        if (info === undefined || info === null) {
            return;
        }
        const infoHtml = this.elements.info;
        infoHtml.innerHTML = "";
        infoHtml.dataset.path = searchPath;
        const innerHtml = [];
        const filename = info["File Name"];
        if (filename !== undefined && filename !== null && filename !== "") {
            innerHtml.push(
                $el("div.row", {
                    style: { margin: "8px 0 16px 0" },
                }, [
                    $el("h1", {
                        style: { margin: "0" },
                    }, [
                        filename,
                    ]),
                    $el("div", [
                        new ComfyButton({
                            icon: "pencil",
                            tooltip: "Change file name",
                            classList: "comfyui-button icon-button",
                            action: async(e) => {
                                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                                button.disabled = true;
                                const container = this.elements.info;
                                const oldFile = container.dataset.path;
                                const [oldFilePath, oldFileName] = SearchPath.split(oldFile);
                                const oldName = SearchPath.splitExtension(oldFileName)[0];
                                const newName = window.prompt("New model name:", oldName);
                                let renamed = false;
                                if (newName !== null && newName !== "" && newName != oldName) {
                                    const newFile = (
                                        oldFilePath + 
                                        searchSeparator + 
                                        newName + 
                                        SearchPath.splitExtension(oldFile)[1]
                                    );
                                    renamed = await request(
                                        `/model-manager/model/move`,
                                        {
                                            method: "POST",
                                            body: JSON.stringify({
                                                "oldFile": oldFile,
                                                "newFile": newFile,
                                            }),
                                        }
                                    )
                                    .then((result) => {
                                        const renamed = result["success"];
                                        const message = result["alert"];
                                        if (message !== undefined) {
                                            window.alert(message);
                                        }
                                        if (renamed)
                                        {
                                            container.innerHTML = "";
                                            this.element.style.display = "none";
                                            updateModels();
                                        }
                                        return renamed;
                                    })
                                    .catch(err => {
                                        console.log(err);
                                        return false;
                                    });
                                }
                                comfyButtonAlert(e.target, renamed);
                                button.disabled = false;
                            },
                        }).element,
                    ]),
                ]),
            );
        }
        
        const fileDirectory = info["File Directory"];
        if (fileDirectory !== undefined && fileDirectory !== null && fileDirectory !== "") {
            this.elements.moveDestinationInput.placeholder = fileDirectory
            this.elements.moveDestinationInput.value = fileDirectory; // TODO: noise vs convenience
        }
        else {
            this.elements.moveDestinationInput.placeholder = searchSeparator;
            this.elements.moveDestinationInput.value = searchSeparator;
        }
        
        const previewSelect = this.previewSelect;
        const defaultUrl = previewSelect.elements.defaultUrl;
        if (info["Preview"]) {
            const imagePath = info["Preview"]["path"];
            const imageDateModified = info["Preview"]["dateModified"];
            defaultUrl.dataset.noimage = imageUri(imagePath, imageDateModified);
        }
        else {
            defaultUrl.dataset.noimage = PREVIEW_NONE_URI;
        }
        previewSelect.resetModelInfoPreview();
        const setPreviewButton = this.elements.setPreviewButton;
        setPreviewButton.style.display = previewSelect.defaultIsChecked() ? "none" : "block";
        
        innerHtml.push($el("div", [
            previewSelect.elements.previews,
            $el("div.row.tab-header", [
                $el("div", [
                    new ComfyButton({
                        content: "Load Workflow",
                        tooltip: "Attempt to load preview image workflow",
                        action: async () => {
                            const urlString = previewSelect.elements.defaultPreviews.children[0].src;
                            await loadWorkflow(urlString);
                        },
                    }).element,
                ]),
                $el("div.row.tab-header-flex-block", [
                    previewSelect.elements.radioGroup,
                ]),
                $el("div.row.tab-header-flex-block", [
                    setPreviewButton,
                ]),
            ]),
            $el("h2", ["File Info:"]),
            $el("div", 
                (() => {
                    const elements = [];
                    for (const [key, value] of Object.entries(info)) {
                        if (value === undefined || value === null) {
                            continue;
                        }
                        
                        if (Array.isArray(value)) {
                            // currently only used for "Bucket Resolutions"
                            if (value.length > 0) {
                                elements.push($el("h2", [key + ":"]));
                                const text = TagCountMapToParagraph(value);
                                const div = $el("div");
                                div.innerHTML = text;
                                elements.push(div);
                            }
                        }
                        else {
                            if (key === "Description") {
                                if (value !== "") {
                                    elements.push($el("h2", [key + ":"]));
                                    elements.push($el("p", [value]));
                                }
                            }
                            else if (key === "Preview") {
                                //
                            }
                            else {
                                if (value !== "") {
                                    elements.push($el("p", [key + ": " + value]));
                                }
                            }
                        }
                    }
                    return elements;
                })(),
            ),
        ]));
        infoHtml.append.apply(infoHtml, innerHtml);
        // TODO: set default value of dropdown and value to model type?
        
        /** @type {HTMLDivElement} */
        const metadataElement = this.elements.tabContents[1]; // TODO: remove magic value
        const isMetadata = typeof metadata === 'object' && metadata !== null && Object.keys(metadata).length > 0;
        metadataElement.innerHTML = "";
        metadataElement.append.apply(metadataElement, [
            $el("h1", { style: { "margin-top": "0px" } }, ["Metadata"]),
            $el("div", (() => {
                    const tableRows = [];
                    if (isMetadata) {
                        for (const [key, value] of Object.entries(metadata)) {
                            if (value === undefined || value === null) {
                                continue;
                            }
                            if (value !== "") {
                                tableRows.push($el("tr", [
                                    $el("th.model-metadata-key", [key]),
                                    $el("th.model-metadata-value", [value]),
                                ]));
                            }
                        }
                    }
                    return $el("table.model-metadata", tableRows);
                })(),
            ),
        ]);
        const metadataButton = this.elements.tabButtons[1]; // TODO: remove magic value
        metadataButton.style.display = isMetadata ? "" : "none";
        
        /** @type {HTMLDivElement} */
        const tagsElement = this.elements.tabContents[2]; // TODO: remove magic value
        const isTags = Array.isArray(tags) && tags.length > 0;
        const tagsParagraph = $el("div", (() => {
                const elements = [];
                if (isTags) {
                    let text = TagCountMapToParagraph(tags);
                    const div = $el("div");
                    div.innerHTML = text;
                    elements.push(div);
                }
                return elements;
            })(),
        );
        const tagGeneratorRandomizedOutput = $el("textarea.comfy-multiline-input", {
            name: "random tag generator output",
            rows: 4,
        });
        const TAG_GENERATOR_SAMPLER_NAME = "model manager tag generator sampler";
        const tagGenerationCount = $el("input", {
            type: "number",
            name: "tag generator count",
            step: 1,
            min: 1,
            value: this.#settingsElements["tag-generator-count"].value,
        });
        const tagGenerationThreshold = $el("input", {
            type: "number",
            name: "tag generator threshold",
            step: 1,
            min: 1,
            value: this.#settingsElements["tag-generator-threshold"].value,
        });
        const selectedSamplerOption = this.#settingsElements["tag-generator-sampler-method"].value;
        const samplerOptions = ["Frequency", "Uniform"];
        const samplerRadioGroup = $radioGroup({
            name: TAG_GENERATOR_SAMPLER_NAME,
            onchange: (value) => {},
            options: samplerOptions.map(option => { return { value: option }; }),
        });
        const samplerOptionInputs = samplerRadioGroup.getElementsByTagName("input");
        for (let i = 0; i < samplerOptionInputs.length; i++) {
            const samplerOptionInput = samplerOptionInputs[i];
            if (samplerOptionInput.value === selectedSamplerOption) {
                samplerOptionInput.click();
                break;
            }
        }
        tagsElement.innerHTML = "";
        tagsElement.append.apply(tagsElement, [
            $el("h1", { style: { "margin-top": "0px", "margin-bottom": "0px" } }, ["Tags"]),
            $el("h2", ["Random Tag Generator"]),
            $el("div", [
                $el("details.tag-generator-settings", {
                    style: { margin: "10px 0", display: "none" },
                    open: false,
                }, [
                    $el("summary", ["Settings"]),
                    $el("div", [
                        "Sampling Method",
                        samplerRadioGroup,
                    ]),
                    $el("label", [
                        "Count",
                        tagGenerationCount,
                    ]),
                    $el("label", [
                        "Threshold",
                        tagGenerationThreshold,
                    ]),
                ]),
                tagGeneratorRandomizedOutput,
                new ComfyButton({
                    content: "Randomize",
                    tooltip: "Randomly generate subset of tags",
                    action: () => {
                        const samplerName = document.querySelector(`input[name="${TAG_GENERATOR_SAMPLER_NAME}"]:checked`).value;
                        const sampler = samplerName === "Frequency" ? ModelInfo.ProbabilisticTagSampling : ModelInfo.UniformTagSampling;
                        const sampleCount = tagGenerationCount.value;
                        const frequencyThreshold = tagGenerationThreshold.value;
                        const tags = ParseTagParagraph(tagsParagraph.innerText);
                        const sampledTags = sampler(tags, sampleCount, frequencyThreshold);
                        tagGeneratorRandomizedOutput.value = sampledTags.join(", ");
                    },
                }).element,
            ]),
            $el("h2", ["Training Tags"]),
            tagsParagraph,
        ]);
        const tagButton = this.elements.tabButtons[2]; // TODO: remove magic value
        tagButton.style.display = isTags ? "" : "none";
        
        /** @type {HTMLDivElement} */
        const notesElement = this.elements.tabContents[3]; // TODO: remove magic value
        notesElement.innerHTML = "";
        notesElement.append.apply(notesElement,
            (() => {
                const notes = $el("textarea.comfy-multiline-input", {
                    name: "model notes",
                    value: noteText, 
                });
                this.elements.notes = notes;
                this.#savedNotesValue = noteText;
                return [
                    $el("div.row", {
                        style: { margin: "0px 0px 16px" },
                    }, [
                        $el("h1", { style: { "margin-top": "0px", "margin-bottom": "0px" } }, ["Notes"]),
                        new ComfyButton({
                            icon: "content-save",
                            tooltip: "Save note",
                            classList: "comfyui-button icon-button",
                            action: async (e) => {
                                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                                button.disabled = true;
                                const saved = await this.trySave(false);
                                comfyButtonAlert(e.target, saved);
                                button.disabled = false;
                            },
                        }).element,
                    ]),
                    $el("div", {
                        style: { "display": "flex", "height": "100%", "min-height": "60px" },
                    }, notes),
                ];
            })()
        );
    }
    
    static UniformTagSampling(tagsAndCounts, sampleCount, frequencyThreshold = 0) {
        const data = tagsAndCounts.filter(x => x[1] >= frequencyThreshold);
        let count = data.length;
        const samples = [];
        for (let i = 0; i < sampleCount; i++) {
            if (count === 0) { break; }
            const index = Math.floor(Math.random() * count);
            const pair = data.splice(index, 1)[0];
            samples.push(pair);
            count -= 1;
        }
        const sortedSamples = samples.sort((x1, x2) => { return parseInt(x2[1]) - parseInt(x1[1]) });
        return sortedSamples.map(x => x[0]);
    }
    
    static ProbabilisticTagSampling(tagsAndCounts, sampleCount, frequencyThreshold = 0) {
        const data = tagsAndCounts.filter(x => x[1] >= frequencyThreshold);
        let tagFrequenciesSum = data.reduce((accumulator, x) => accumulator + x[1], 0);
        let count = data.length;
        const samples = [];
        for (let i = 0; i < sampleCount; i++) {
            if (count === 0) { break; }
            const index = (() => {
                let frequencyIndex = Math.floor(Math.random() * tagFrequenciesSum);
                return data.findIndex(x => {
                    const frequency = x[1];
                    if (frequency > frequencyIndex) {
                        return true;
                    }
                    frequencyIndex = frequencyIndex - frequency;
                    return false;
                });
            })();
            const pair = data.splice(index, 1)[0];
            samples.push(pair);
            tagFrequenciesSum -= pair[1];
            count -= 1;
        }
        const sortedSamples = samples.sort((x1, x2) => { return parseInt(x2[1]) - parseInt(x1[1]) });
        return sortedSamples.map(x => x[0]);
    }
}

class Civitai {
    /**
     * Get model info from Civitai.
     *
     * @param {string} id - Model ID.
     * @param {string} apiPath - Civitai request subdirectory. "models" for 'model' urls. "model-version" for 'api' urls.
     *
     * @returns {Promise<Object>} Dictionary containing received model info. Returns an empty if fails.
     */
    static async requestInfo(id, apiPath) {
        const url = "https://civitai.com/api/v1/" + apiPath +  "/" + id;
        try {
            return await request(url);
        }
        catch (error) {
            console.error("Failed to get model info from Civitai!", error);
            return {};
        }
    }
    
    /**
     * Extract file information from the given model version information.
     *
     * @param {Object} modelVersionInfo - Model version information.
     * @param {(string|null)} [type=null] - Optional select by model type.
     * @param {(string|null)} [fp=null] - Optional select by floating point quantization.
     * @param {(string|null)} [size=null] - Optional select by sizing.
     * @param {(string|null)} [format=null] - Optional select by file format.
     *
     * @returns {Object} - Extracted list of information on each file of the given model version.
     */
    static getModelFilesInfo(modelVersionInfo, type = null, fp = null, size = null, format = null) {
        const files = [];
        const modelVersionFiles = modelVersionInfo["files"];
        for (let i = 0; i < modelVersionFiles.length; i++) {
            const modelVersionFile = modelVersionFiles[i];
            
            const fileType = modelVersionFile["type"];
            if (type instanceof String && type != fileType) { continue; }
            
            const fileMeta = modelVersionFile["metadata"];
            
            const fileFp = fileMeta["fp"];
            if (fp instanceof String && fp != fileFp) { continue; }
            
            const fileSize = fileMeta["size"];
            if (size instanceof String && size != fileSize) { continue; }
            
            const fileFormat = fileMeta["format"];
            if (format instanceof String && format != fileFormat) { continue; }
            
            files.push({
                "downloadUrl": modelVersionFile["downloadUrl"],
                "format": fileFormat,
                "fp": fileFp,
                "hashes": modelVersionFile["hashes"],
                "name": modelVersionFile["name"],
                "size": fileSize,
                "sizeKB": modelVersionFile["sizeKB"],
                "type": fileType,
            });
        }
        return {
            "files": files,
            "id": modelVersionInfo["id"],
            "images": modelVersionInfo["images"].map((image) => {
                // TODO: do I need to double-check image matches resource?
                return image["url"];
            }),
            "name": modelVersionInfo["name"],
            "description": modelVersionInfo["description"] ?? "",
        };
    }
    
    /**
     * @param {string} stringUrl - Model url.
     *
     * @returns {Promise<Object>} - Download information for the given url.
     */
    static async getFilteredInfo(stringUrl) {
        const url = new URL(stringUrl);
        if (url.hostname != "civitai.com") { return {}; }
        if (url.pathname == "/") { return {} }
        const urlPath = url.pathname;
        if (urlPath.startsWith("/api")) {
            const idEnd = urlPath.length - (urlPath.at(-1) == "/" ? 1 : 0);
            const idStart = urlPath.lastIndexOf("/", idEnd - 1) + 1;
            const modelVersionId = urlPath.substring(idStart, idEnd);
            if (parseInt(modelVersionId, 10) == NaN) {
                return {};
            }
            const modelVersionInfo = await Civitai.requestInfo(modelVersionId, "model-versions");
            if (Object.keys(modelVersionInfo).length == 0) {
                return {};
            }
            const searchParams = url.searchParams;
            const filesInfo = Civitai.getModelFilesInfo(
                modelVersionInfo,
                searchParams.get("type"),
                searchParams.get("fp"),
                searchParams.get("size"),
                searchParams.get("format"),
            );
            return {
                "name": modelVersionInfo["model"]["name"],
                "type": modelVersionInfo["model"]["type"],
                "description": modelVersionInfo["description"] ?? "",
                "versions": [filesInfo]
            }
        }
        else if (urlPath.startsWith('/models')) {
            const idStart = urlPath.indexOf("models/") + "models/".length;
            const idEnd = (() => {
                const idEnd = urlPath.indexOf("/", idStart);
                return idEnd === -1 ? urlPath.length : idEnd;
            })();
            const modelId = urlPath.substring(idStart, idEnd);
            if (parseInt(modelId, 10) == NaN) {
                return {};
            }
            const modelInfo = await Civitai.requestInfo(modelId, "models");
            if (Object.keys(modelInfo).length == 0) {
                return {};
            }
            const modelVersionId = parseInt(url.searchParams.get("modelVersionId"));
            const modelVersions = [];
            const modelVersionInfos = modelInfo["modelVersions"];
            for (let i = 0; i < modelVersionInfos.length; i++) {
                const versionInfo = modelVersionInfos[i];
                if (!Number.isNaN(modelVersionId)) {
                    if (modelVersionId != versionInfo["id"]) {continue; }
                }
                const filesInfo = Civitai.getModelFilesInfo(versionInfo);
                modelVersions.push(filesInfo);
            }
            return {
                "name": modelInfo["name"],
                "type": modelInfo["type"],
                "description": modelInfo["description"] ?? "",
                "versions": modelVersions,
            }
        }
        else {
            return {};
        }
    }
    
    /**
     * @returns {string}
     */
    static imagePostUrlPrefix() {
        return "https://civitai.com/images/";
    }
    
    /**
     * @returns {string}
     */
    static imageUrlPrefix() {
        return "https://image.civitai.com/";
    }
    
    /**
     * @param {string} stringUrl - https://civitai.com/images/{imageId}.
     *
     * @returns {Promise<Object>} - Image information.
     */
    static async getImageInfo(stringUrl) {
        const imagePostUrlPrefix = Civitai.imagePostUrlPrefix();
        if (!stringUrl.startsWith(imagePostUrlPrefix)) {
            return {};
        }
        const id = stringUrl.substring(imagePostUrlPrefix.length).match(/^\d+/)[0];
        const url = `https://civitai.com/api/v1/images?imageId=${id}`;
        try {
            return await request(url);
        }
        catch (error) {
            console.error("Failed to get image info from Civitai!", error);
            return {};
        }
    }
    
    /**
     * @param {string} stringUrl - https://image.civitai.com/...
     *
     * @returns {Promise<string>}
     */
    static async getFullSizeImageUrl(stringUrl) {
        const imageUrlPrefix = Civitai.imageUrlPrefix();
        if (!stringUrl.startsWith(imageUrlPrefix)) {
            return "";
        }
        const i0 = stringUrl.lastIndexOf("/");
        const i1 = stringUrl.lastIndexOf(".");
        if (i0 === -1 || i1 === -1) {
            return "";
        }
        const id = parseInt(stringUrl.substring(i0 + 1, i1)).toString();
        const url = `https://civitai.com/api/v1/images?imageId=${id}`;
        try {
            const imageInfo = await request(url);
            const items = imageInfo["items"];
            if (items.length === 0) {
                console.warn("Civitai /api/v1/images returned 0 items.");
                return stringUrl;
            }
            return items[0]["url"];
        }
        catch (error) {
            console.error("Failed to get image info from Civitai!", error);
            return stringUrl;
        }
    }
}

class HuggingFace {
    /**
     * Get model info from Huggingface.
     *
     * @param {string} id - Model ID.
     * @param {string} apiPath - API path.
     *
     * @returns {Promise<Object>} Dictionary containing received model info. Returns an empty if fails.
     */
    static async requestInfo(id, apiPath = "models") {
        const url = "https://huggingface.co/api/" + apiPath + "/" + id;
        try {
            return await request(url);
        }
        catch (error) {
            console.error("Failed to get model info from HuggingFace!", error);
            return {};
        }
    }
    
    /**
     * 
     *
     * @param {string} stringUrl - Model url.
     *
     * @returns {Promise<Object>}
     */
    static async getFilteredInfo(stringUrl) {
        const url = new URL(stringUrl);
        if (url.hostname != "huggingface.co") { return {}; }
        if (url.pathname == "/") { return {} }
        const urlPath = url.pathname;
        const i0 = 1;
        const i1 = urlPath.indexOf("/", i0);
        if (i1 == -1 || urlPath.length - 1 == i1) {
            // user-name only
            return {};
        }
        let i2 = urlPath.indexOf("/", i1 + 1);
        if (i2 == -1) {
            // model id only
            i2 = urlPath.length;
        }
        const modelId = urlPath.substring(i0, i2);
        const urlPathEnd = urlPath.substring(i2);
        
        const isValidBranch = (
            urlPathEnd.startsWith("/resolve") ||
            urlPathEnd.startsWith("/blob") ||
            urlPathEnd.startsWith("/tree")
        );
        
        let branch = "/main";
        let filePath = "";
        if (isValidBranch) {
            const i0 = branch.length;
            const i1 = urlPathEnd.indexOf("/", i0 + 1);
            if (i1 == -1) {
                if (i0 != urlPathEnd.length) {
                    // ends with branch
                    branch = urlPathEnd.substring(i0);
                }
            }
            else {
                branch = urlPathEnd.substring(i0, i1);
                if (urlPathEnd.length - 1 > i1) {
                    filePath = urlPathEnd.substring(i1);
                }
            }
        }
        
        const modelInfo = await HuggingFace.requestInfo(modelId);
        //const modelInfo = await requestInfo(modelId + "/tree" + branch); // this only gives you the files at the given branch path...
        // oid: SHA-1?, lfs.oid: SHA-256
        
        const clippedFilePath = filePath.substring(filePath[0] === "/" ? 1 : 0);
        const modelFiles = modelInfo["siblings"].filter((sib) => {
            const filename = sib["rfilename"];
            for (let i = 0; i < MODEL_EXTENSIONS.length; i++) {
                if (filename.endsWith(MODEL_EXTENSIONS[i])) {
                    return filename.startsWith(clippedFilePath);
                }
            }
            return false;
        }).map((sib) => {
            const filename = sib["rfilename"];
            return filename;
        });
        if (modelFiles.length === 0) {
            return {};
        }
        
        const baseDownloadUrl = url.origin + urlPath.substring(0, i2) + "/resolve" + branch;
        
        const images = modelInfo["siblings"].filter((sib) => {
            const filename = sib["rfilename"];
            for (let i = 0; i < IMAGE_EXTENSIONS.length; i++) {
                if (filename.endsWith(IMAGE_EXTENSIONS[i])) {
                    return filename.startsWith(clippedFilePath);
                }
            }
            return false;
        }).map((sib) => {
            return baseDownloadUrl + "/" + sib["rfilename"];
        });
        
        return {
            "baseDownloadUrl": baseDownloadUrl,
            "modelFiles": modelFiles,
            "images": images,
            "name": modelId,
        };
    }
}

/**
 * @param {string} urlText 
 * @returns {Promise<[string, any[]]>} [name, modelInfos]
 */
async function getModelInfos(urlText) {
    // TODO: class for proper return type
    return await (async () => {
        if (urlText.startsWith("https://civitai.com")) {
            const civitaiInfo = await Civitai.getFilteredInfo(urlText);
            if (Object.keys(civitaiInfo).length === 0) {
                return ["", []];
            }
            const name = civitaiInfo["name"];
            const infos = [];
            const type = civitaiInfo["type"];
            const modelInfo = civitaiInfo["description"]?? "";
            civitaiInfo["versions"].forEach((version) => {
                const images = version["images"];
                const versionDescription = version["description"]??"";
                const description = (versionDescription + "\n\n" + modelInfo).trim().replace(/<[^>]+>/g, ""); // quick hack
                version["files"].forEach((file) => {
                    infos.push({
                        "images": images,
                        "fileName": file["name"],
                        "modelType": type,
                        "downloadUrl": file["downloadUrl"],
                        "downloadFilePath": "",
                        "description": description,
                        "details": {
                            "fileSizeKB": file["sizeKB"],
                            "fileType": file["type"],
                            "fp": file["fp"],
                            "quant": file["size"],
                            "fileFormat": file["format"],
                        },
                    });
                });
            });
            return [name, infos];
        }
        if (urlText.startsWith("https://huggingface.co")) {
            const hfInfo = await HuggingFace.getFilteredInfo(urlText);
            if (Object.keys(hfInfo).length === 0) {
                return ["", []];
            }
            const files = hfInfo["modelFiles"];
            if (files.length === 0) {
                return ["", []];
            }
            const name = hfInfo["name"];
            const baseDownloadUrl = hfInfo["baseDownloadUrl"];
            const infos = hfInfo["modelFiles"].map((file) => {
                const indexSep = file.lastIndexOf("/");
                const filename = file.substring(indexSep + 1);
                return {
                    "images": hfInfo["images"],
                    "fileName": filename,
                    "modelType": "",
                    "downloadUrl": baseDownloadUrl + "/" + file + "?download=true",
                    "downloadFilePath": file.substring(0, indexSep + 1),
                    "description": "",
                    "details": {
                        "fileSizeKB": undefined, // TODO: too hard?
                    },
                };
            });
            return [name, infos];
        }
        if (urlText.endsWith(".json")) {
            const indexInfo = await request(urlText).catch(() => []);
            const name = urlText.substring(math.max(urlText.lastIndexOf("/"), 0));
            const infos = indexInfo.map((file) => {
                return {
                    "images": [],
                    "fileName": file["name"],
                    "modelType": DownloadView.modelTypeToComfyUiDirectory(file["type"], "") ?? "",
                    "downloadUrl": file["download"],
                    "downloadFilePath": "",
                    "description": file["description"],
                    "details": {},
                };
            });
            return [name, infos];
        }
        return ["", []];
    })();
}

class DownloadView {
    /** @type {HTMLDivElement} */
    element = null;
    
    elements = {
        /** @type {HTMLInputElement} */ url: null,
        /** @type {HTMLDivElement} */ infos: null,
        /** @type {HTMLInputElement} */ overwrite: null,
        /** @type {HTMLInputElement} */ downloadNotes: null,
    };
    
    /** @type {DOMParser} */
    #domParser = null;
    
    /** @type {() => Promise<void>} */
    #updateModels = () => {};
    
    /**
     * @param {ModelData} modelData
     * @param {any} settings
     * @param {() => Promise<void>} updateModels
     */
    constructor(modelData, settings, updateModels) {
        this.#domParser = new DOMParser();
        this.#updateModels = updateModels;
        const update = async() => { await this.#update(modelData, settings); };
        $el("div.tab-header", {
            $: (el) => (this.element = el),
        }, [
            $el("div.row.tab-header-flex-block", [
                $el("input.search-text-area", {
                    $: (el) => (this.elements.url = el),
                    type: "text",
                    name: "model download url",
                    autocomplete: "off",
                    placeholder: "Search URL...",
                    onkeydown: async (e) => {
                        if (e.key === "Enter") {
                            e.stopPropagation();
                            await update();
                            e.target.blur();
                        }
                    },
                }),
                new ComfyButton({
                    icon: "magnify",
                    tooltip: "Search url",
                    classList: "comfyui-button icon-button",
                    action: async(e) => {
                        const [button, icon, span] = comfyButtonDisambiguate(e.target);
                        button.disabled = true;
                        await update();
                        button.disabled = false;
                    },
                }).element,
            ]),
            $el("div.download-model-infos", {
                $: (el) => (this.elements.infos = el),
            }, [
                $el("h1", ["Input a URL to select a model to download."]),
            ]),
        ]);
    }
    
    /**
     * Tries to return the related ComfyUI model directory if unambiguous.
     *
     * @param {string | undefined} modelType - Model type.
     * @param {string | undefined} [fileType] - File type. Relevant for "Diffusers".
     *
     * @returns {(string | null)} Logical base directory name for model type. May be null if the directory is ambiguous or not a model type.
     */
    static modelTypeToComfyUiDirectory(modelType, fileType) {
        if (fileType !== undefined && fileType !== null) {
            const f = fileType.toLowerCase();
            if (f == "diffusers") { return "diffusers"; } // TODO: is this correct?
        }
        
        if (modelType !== undefined && modelType !== null) {
            const m = modelType.toLowerCase();
            // TODO: somehow allow for SERVER to set dir?
            // TODO: allow user to choose EXISTING folder override/null? (style_models, HuggingFace) (use an object/map instead so settings can be dynamically set)
            if (m == "aestheticGradient") { return null; }
            else if (m == "checkpoint" || m == "checkpoints") { return "checkpoints"; }
            //else if (m == "") { return "clip"; }
            //else if (m == "") { return "clip_vision"; }
            else if (m == "controlnet") { return "controlnet"; }
            //else if (m == "Controlnet") { return "style_models"; } // are these controlnets? (TI-Adapter)
            //else if (m == "") { return "gligen"; }
            else if (m == "hypernetwork" || m == "hypernetworks") { return "hypernetworks"; }
            else if (m == "lora" || m == "loras") { return "loras"; }
            else if (m == "locon") { return "loras"; }
            else if (m == "motionmodule") { return null; }
            else if (m == "other") { return null; }
            else if (m == "pose") { return null; }
            else if (m == "textualinversion" || m == "embedding" || m == "embeddings") { return "embeddings"; }
            //else if (m == "") { return "unet"; }
            else if (m == "upscaler" || m == "upscale_model" || m == "upscale_models") { return "upscale_models"; }
            else if (m == "vae") { return "vae"; }
            else if (m == "wildcard" || m == "wildcards") { return null; }
            else if (m == "workflow" || m == "workflows") { return null; }
        }
        return null;
    }
    
    /**
     * Returns empty string on failure
     * @param {float | undefined} fileSizeKB 
     * @returns {string}
     */
    static #fileSizeToFormattedString(fileSizeKB) {
        if (fileSizeKB === undefined) { return ""; }
        const sizes = ["KB", "MB", "GB", "TB", "PB"];
        let fileSizeString = fileSizeKB.toString();
        const index = fileSizeString.indexOf(".");
        const indexMove = index % 3 === 0 ? 3 : index % 3;
        const sizeIndex = Math.floor((index - indexMove) / 3);
        if (sizeIndex >= sizes.length || sizeIndex < 0) {
            fileSizeString = fileSizeString.substring(0, fileSizeString.indexOf(".") + 3);
            return `(${fileSizeString} ${sizes[0]})`;
        }
        const split = fileSizeString.split(".");
        fileSizeString = split[0].substring(0, indexMove) + "." + split[0].substring(indexMove) + split[1];
        fileSizeString = fileSizeString.substring(0, fileSizeString.indexOf(".") + 3);
        return `(${fileSizeString} ${sizes[sizeIndex]})`;
    }
    
    /**
     * @param {Object} info
     * @param {ModelData} modelData
     * @param {int} id
     * @param {any} settings
     * @returns {HTMLDivElement}
     */
    #modelInfoHtml(info, modelData, id, settings) {
        const downloadPreviewSelect = new ImageSelect(
            "model-download-info-preview-model" + "-" + id,
            info["images"],
        );
        
        const comfyUIModelType = (
            DownloadView.modelTypeToComfyUiDirectory(info["details"]["fileType"]) ??
            DownloadView.modelTypeToComfyUiDirectory(info["modelType"]) ??
            ""
        );
        const searchSeparator = modelData.searchSeparator;
        const defaultBasePath = searchSeparator + (comfyUIModelType === "" ? "" : comfyUIModelType + searchSeparator + "0");
        
        const el_saveDirectoryPath = $el("input.search-text-area", {
            type: "text",
            name: "save directory",
            autocomplete: "off",
            placeholder: defaultBasePath,
            value: defaultBasePath,
        });
        const searchDropdown = new DirectoryDropdown(
            modelData,
            el_saveDirectoryPath,
            true,
        );
        
        const default_name = (() => {
            const filename = info["fileName"];
            // TODO: only remove valid model file extensions
            const i = filename.lastIndexOf(".");
            return i === - 1 ? filename : filename.substring(0, i);
        })();
        const el_filename = $el("input.plain-text-area", {
            type: "text",
            name: "model save file name",
            autocomplete: "off",
            placeholder: default_name,
            value: default_name,
            onkeydown: (e) => {
                if (e.key === "Enter") {
                    e.stopPropagation();
                    e.target.blur();
                }
            },
        });
        
        const filepath = info["downloadFilePath"];
        const modelInfo = $el("details.download-details", [
            $el("summary", [filepath + info["fileName"]]),
            $el("div", [
                downloadPreviewSelect.elements.previews,
                $el("div.download-settings-wrapper", [
                    $el("div.download-settings", [
                        new ComfyButton({
                            icon: "arrow-collapse-down",
                            tooltip: "Download model",
                            content: "Download " + DownloadView.#fileSizeToFormattedString(info["details"]["fileSizeKB"]),
                            classList: "comfyui-button download-button",
                            action: async (e) => {
                                const pathDirectory = el_saveDirectoryPath.value;
                                const modelName = (() => {
                                    const filename = info["fileName"];
                                    const name = el_filename.value;
                                    if (name === "") {
                                        return filename;
                                    }
                                    const ext = MODEL_EXTENSIONS.find((ext) => {
                                        return filename.endsWith(ext);
                                    }) ?? "";
                                    return name + ext;
                                })();
                                const formData = new FormData();
                                formData.append("download", info["downloadUrl"]);
                                formData.append("path", pathDirectory);
                                formData.append("name", modelName);
                                const image = await downloadPreviewSelect.getImage();
                                formData.append("image", image === PREVIEW_NONE_URI ? "" : image);
                                formData.append("overwrite", this.elements.overwrite.checked);
                                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                                button.disabled = true;
                                const [success, resultText] = await request(
                                    "/model-manager/model/download",
                                    {
                                        method: "POST",
                                        body: formData,
                                    }
                                ).then((data) => {
                                    const success = data["success"];
                                    const message = data["alert"];
                                    if (message !== undefined) {
                                        window.alert(message);
                                    }
                                    return [success, success ? "✔" : "📥︎"];
                                }).catch((err) => {
                                    return [false, "📥︎"];
                                });
                                if (success) {
                                    const description = info["description"];
                                    if (this.elements.downloadNotes.checked && description !== "") {
                                        const modelPath = pathDirectory + searchSeparator + modelName;
                                        const saved = await saveNotes(modelPath, description);
                                        if (!saved) {
                                            console.warn("Description was note saved as notes!");
                                        }
                                    }
                                    this.#updateModels();
                                }
                                comfyButtonAlert(e.target, success, "mdi-check-bold", "mdi-close-thick", true);
                                button.disabled = success;
                            },
                        }).element,
                        $el("div.row.tab-header-flex-block", [
                            el_saveDirectoryPath,
                            searchDropdown.element,
                        ]),
                        $el("div.row.tab-header-flex-block", [
                            el_filename,
                        ]),
                        downloadPreviewSelect.elements.radioGroup,
                    ]),
                ]),
            ]),
        ]);
        
        return modelInfo;
    }

    /**
     * @param {ModelData} modelData
     * @param {any} settings
     */
    async #update(modelData, settings) {
        const [name, modelInfos] = await getModelInfos(this.elements.url.value);
        const modelInfosHtml = modelInfos.filter((modelInfo) => {
            const filename = modelInfo["fileName"];
            return MODEL_EXTENSIONS.find((ext) => {
                return filename.endsWith(ext);
            }) ?? false;
        }).map((modelInfo, id) => {
            return this.#modelInfoHtml(
                modelInfo,
                modelData,
                id,
                settings,
            );
        });
        if (modelInfosHtml.length === 0) {
            modelInfosHtml.push($el("h1", ["No models found."]));
        }
        else {
            if (modelInfosHtml.length === 1) {
                modelInfosHtml[0].open = true;
            }
            
            const header = $el("div", [
                $el("h1", [name]),
                $el("div.model-manager-settings", [
                    $checkbox({
                        $: (el) => { this.elements.overwrite = el; },
                        textContent: "Overwrite Existing Files.",
                        checked: false,
                    }),
                    $checkbox({
                        $: (el) => { this.elements.downloadNotes = el; },
                        textContent: "Save Model Descriptions in Text Files.",
                        checked: settings["download-save-description-as-text-file"].checked,
                    }),
                ])
            ]);
            modelInfosHtml.unshift(header);
        }

        const infosHtml = this.elements.infos;
        infosHtml.innerHTML = "";
        infosHtml.append.apply(infosHtml, modelInfosHtml);
    }
}

class BrowseView {
    /** @type {HTMLDivElement} */
    element = null;
    
    elements = {
        /** @type {HTMLDivElement} */ modelGrid: null,
        /** @type {HTMLSelectElement} */ modelTypeSelect: null,
        /** @type {HTMLSelectElement} */ modelSortSelect: null,
        /** @type {HTMLInputElement} */ modelContentFilter: null,
    };
    
    /** @type {Array} */
    previousModelFilters = [];
    
    /** @type {Object.<{value: string}>} */
    previousModelType = { value: null };
    
    /** @type {DirectoryDropdown} */
    directoryDropdown = null;
    
    /** @type {ModelData} */
    #modelData = null;
    
    /** @type {@param {() => Promise<void>}} */
    #updateModels = null;
    
    /**  */
    #settingsElements = null;
    
    /** @type {() => void} */
    updateModelGrid = () => {};
    
    /**
     * @param {() => Promise<void>} updateModels
     * @param {ModelData} modelData
     * @param {(searchPath: string) => Promise<void>} showModelInfo
     * @param {() => void} updateModelGridCallback
     * @param {any} settingsElements
     */
    constructor(updateModels, modelData, showModelInfo, updateModelGridCallback, settingsElements) {
        /** @type {HTMLDivElement} */
        const modelGrid = $el("div.comfy-grid");
        this.elements.modelGrid = modelGrid;
        
        this.#updateModels = updateModels;
        this.#modelData = modelData;
        this.#settingsElements = settingsElements;
        
        const searchInput = $el("input.search-text-area", {
            $: (el) => (this.elements.modelContentFilter = el),
            type: "text",
            name: "model search",
            autocomplete: "off",
            placeholder: "/Search...",
        });
        
        const updatePreviousModelFilter = () => {
            const modelType = this.elements.modelTypeSelect.value;
            const value = this.elements.modelContentFilter.value;
            this.previousModelFilters[modelType] = value;
        };
        
        const updateModelGrid = () => {
            const sortValue = this.elements.modelSortSelect.value;
            const reverseSort = sortValue[0] === "-";
            const sortBy = reverseSort ? sortValue.substring(1) : sortValue;
            ModelGrid.update(
                this.elements.modelGrid,
                this.#modelData,
                this.elements.modelTypeSelect,
                this.previousModelType,
                this.#settingsElements,
                sortBy,
                reverseSort,
                this.previousModelFilters,
                this.elements.modelContentFilter,
                showModelInfo,
            );
            updateModelGridCallback();
        }
        this.updateModelGrid = updateModelGrid;
        
        const searchDropdown = new DirectoryDropdown(
            modelData,
            searchInput,
            false,
            () => { return this.elements.modelTypeSelect.value; },
            updatePreviousModelFilter,
            updateModelGrid,
            () => { return this.#settingsElements["model-real-time-search"].checked; },
        );
        this.directoryDropdown = searchDropdown;
        
        this.element = $el("div", [
            $el("div.row.tab-header", [
                $el("div.row.tab-header-flex-block", [
                    new ComfyButton({
                        icon: "reload",
                        tooltip: "Reload model grid",
                        classList: "comfyui-button icon-button",
                        action: async(e) => {
                            const [button, icon, span] = comfyButtonDisambiguate(e.target);
                            button.disabled = true;
                            updateModels();
                            button.disabled = false;
                        },
                    }).element,
                    $el("select.model-select-dropdown", {
                        $: (el) => (this.elements.modelTypeSelect = el),
                        name: "model-type",
                        onchange: (e) => {
                            const select = e.target;
                            select.disabled = true;
                            updateModelGrid();
                            select.disabled = false;
                        },
                    }),
                    $el("select.model-select-dropdown",
                        {
                            $: (el) => (this.elements.modelSortSelect = el),
                            name: "model select dropdown",
                            onchange: (e) => {
                                const select = e.target;
                                select.disabled = true;
                                updateModelGrid();
                                select.disabled = false;
                            },
                        },
                        [
                            $el("option", { value: MODEL_SORT_DATE_CREATED }, ["Created (newest first)"]),
                            $el("option", { value: "-" + MODEL_SORT_DATE_CREATED }, ["Created (oldest first)"]),
                            $el("option", { value: MODEL_SORT_DATE_MODIFIED }, ["Modified (newest first)"]),
                            $el("option", { value: "-" + MODEL_SORT_DATE_MODIFIED }, ["Modified (oldest first)"]),
                            $el("option", { value: MODEL_SORT_DATE_NAME }, ["Name (A-Z)"]),
                            $el("option", { value: "-" + MODEL_SORT_DATE_NAME }, ["Name (Z-A)"]),
                            $el("option", { value: MODEL_SORT_SIZE_BYTES }, ["Size (largest first)"]),
                            $el("option", { value: "-" + MODEL_SORT_SIZE_BYTES }, ["Size (smallest first)"]),
                        ],
                    ),
                ]),
                $el("div.row.tab-header-flex-block", [
                    $el("div.search-models", [
                        searchInput,
                        searchDropdown.element,
                    ]),
                    new ComfyButton({
                        icon: "magnify",
                        tooltip: "Search models",
                        classList: "comfyui-button icon-button",
                        action: (e) => {
                            const [button, icon, span] = comfyButtonDisambiguate(e.target);
                            button.disabled = true;
                            updateModelGrid();
                            button.disabled = false;
                        },
                    }).element,
                ]),
            ]),
            modelGrid,
        ]);
    }
}

class SettingsView {
    /** @type {HTMLDivElement} */
    element = null;
    
    elements = {
        /** @type {HTMLButtonElement} */ reloadButton: null,
        /** @type {HTMLButtonElement} */ saveButton: null,
        /** @type {HTMLDivElement} */ setPreviewButton: null,
        settings: {
            //"sidebar-default-height": null,
            //"sidebar-default-width": null,
            /** @type {HTMLInputElement} */ "sidebar-control-always-compact": null,
            
            /** @type {HTMLTextAreaElement} */ "model-search-always-append": null,
            /** @type {HTMLInputElement} */ "model-real-time-search": null,
            /** @type {HTMLInputElement} */ "model-persistent-search": null,
            /** @type {HTMLInputElement} */ "model-show-label-extensions": null,
            /** @type {HTMLInputElement} */ "model-preview-fallback-search-safetensors-thumbnail": null,
            
            /** @type {HTMLInputElement} */ "model-show-add-button": null,
            /** @type {HTMLInputElement} */ "model-show-copy-button": null,
            /** @type {HTMLInputElement} */ "model-show-load-workflow-button": null,
            /** @type {HTMLInputElement} */ "model-info-button-on-left": null,
            /** @type {HTMLInputElement} */ "model-preview-thumbnail-type": null,
            /** @type {HTMLInputElement} */ "model-add-embedding-extension": null,
            /** @type {HTMLInputElement} */ "model-add-drag-strict-on-field": null,
            /** @type {HTMLInputElement} */ "model-add-offset": null,
            
            /** @type {HTMLInputElement} */ "download-save-description-as-text-file": null,
            
            /** @type {HTMLInputElement} */ "tag-generator-sampler-method": null,
            /** @type {HTMLInputElement} */ "tag-generator-count": null,
            /** @type {HTMLInputElement} */ "tag-generator-threshold": null,
        },
    };
    
    /** @return {() => Promise<void>} */
    #updateModels = () => {};
    
    /**
     * @param {Object} settingsData 
     * @param {boolean} updateModels 
     */
    #setSettings(settingsData, updateModels) {
        const settings = this.elements.settings;
        for (const [key, value] of Object.entries(settingsData)) {
            const setting = settings[key];
            if (setting === undefined || setting === null) {
                continue;
            }
            const type = setting.type;
            switch (type) {
                case "checkbox": setting.checked = Boolean(value); break;
                case "range": setting.value = parseFloat(value); break;
                case "textarea": setting.value = value; break;
                case "number": setting.value = parseInt(value); break;
                case "select-one": setting.value = value; break;
                default: console.warn(`Unknown settings input type '${type}'!`);
            }
        }

        if (updateModels) {
            this.#updateModels(); // Is this slow?
        }
    }
    
    /**
     * @param {boolean} updateModels
     * @returns {Promise<void>}
     */
    async reload(updateModels) {
        const data = await request("/model-manager/settings/load");
        const settingsData = data["settings"];
        this.#setSettings(settingsData, updateModels);
        comfyButtonAlert(this.elements.reloadButton, true);
    }
    
    /** @returns {Promise<void>} */
    async save() {
        let settingsData = {};
        for (const [setting, el] of Object.entries(this.elements.settings)) {
            if (!el) { continue; } // hack
            const type = el.type;
            let value = null;
            switch (type) {
                case "checkbox": value = el.checked; break;
                case "range": value = el.value; break;
                case "textarea": value = el.value; break;
                case "number": value = el.value; break;
                case "select-one": value = el.value; break;
                default: console.warn("Unknown settings input type!");
            }
            settingsData[setting] = value;
        }
        
        const data = await request(
            "/model-manager/settings/save",
            {
                method: "POST",
                body: JSON.stringify({ "settings": settingsData }),
            }
        ).catch((err) => {
            return { "success": false };
        });
        const success = data["success"];
        if (success) {
            const settingsData = data["settings"];
            this.#setSettings(settingsData, true);
        }
        comfyButtonAlert(this.elements.saveButton, success);
    }
    
    /**
     * @param {() => Promise<void>} updateModels
     * @param {() => void} updateSidebarButtons
     */
    constructor(updateModels, updateSidebarButtons) {
        this.#updateModels = updateModels;
        const settings = this.elements.settings;
        
        const sidebarControl = $checkbox({
            $: (el) => (settings["sidebar-control-always-compact"] = el),
            textContent: "Sidebar controls always compact",
        });
        sidebarControl.getElementsByTagName('input')[0].addEventListener("change", () => {
            updateSidebarButtons();
        });
        
        const reloadButton = new ComfyButton({
            content: "Reload",
            tooltip: "Reload settings and model manager files",
            action: async(e) => {
                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                button.disabled = true;
                await this.reload(true);
                button.disabled = false;
            },
        }).element;
        this.elements.reloadButton = reloadButton;
        
        const saveButton = new ComfyButton({
            content: "Save",
            tooltip: "Save settings and reload model manager",
            action: async(e) => {
                const [button, icon, span] = comfyButtonDisambiguate(e.target);
                button.disabled = true;
                await this.save();
                button.disabled = false;
            },
        }).element;
        this.elements.saveButton = saveButton;
        
        $el("div.model-manager-settings", {
            $: (el) => (this.element = el),
        }, [
            $el("h1", ["Settings"]),
            $el("div", [
                reloadButton,
                saveButton,
            ]),
            $el("a", {
                    style: { color: "var(--fg-color)" },
                    href: "https://github.com/hayden-fr/ComfyUI-Model-Manager/issues/"
                }, [
                    "File bugs and issues here."
                ]
            ),
            $el("h2", ["Model Search"]),
            $el("div", [
                $el("div.search-settings-text", [
                    $el("p", ["Always include in model search:"]),
                    $el("textarea.comfy-multiline-input", {
                        $: (el) => (settings["model-search-always-append"] = el),
                        name: "always include in model search",
                        placeholder: "example: /0/sd1.5/styles \"pastel style\" -3d",
                        rows: "6",
                    }),
                ]),
            ]),
            $checkbox({
                $: (el) => (settings["model-real-time-search"] = el),
                textContent: "Real-time search",
            }),
            $checkbox({
                $: (el) => (settings["model-persistent-search"] = el),
                textContent: "Persistent search text across model types",
            }),
            $checkbox({
                $: (el) => (settings["model-show-label-extensions"] = el),
                textContent: "Show model file extension in labels",
            }),
            $checkbox({
                $: (el) => (settings["model-preview-fallback-search-safetensors-thumbnail"] = el),
                textContent: "Fallback on embedded thumbnail in safetensors (refresh slow)",
            }),
            $checkbox({
                $: (el) => (settings["model-show-add-button"] = el),
                textContent: "Show add button",
            }),
            $checkbox({
                $: (el) => (settings["model-show-copy-button"] = el),
                textContent: "Show copy button",
            }),
            $checkbox({
                $: (el) => (settings["model-show-load-workflow-button"] = el),
                textContent: "Show load workflow button",
            }),
            $checkbox({
                $: (el) => (settings["model-info-button-on-left"] = el),
                textContent: "Model info button on the left",
            }),
            $select({
                $: (el) => (settings["model-preview-thumbnail-type"] = el),
                textContent: "Preview thumbnail type",
                options: ["AUTO", "JPEG"], // should use AUTO to avoid artifacts from changing between formats; use JPEG for backward compatibility
            }),
            $el("h2", ["Model Add"]),
            $checkbox({
                $: (el) => (settings["model-add-embedding-extension"] = el),
                textContent: "Add extension to embedding",
            }),
            $checkbox({
                $: (el) => (settings["model-add-drag-strict-on-field"] = el),
                textContent: "Strict dragging model onto a node's model field to add",
            }),
            $el("label", [
                "Add model offset",
                $el("input", {
                    $: (el) => (settings["model-add-offset"] = el),
                    type: "number",
                    name: "model add offset",
                    step: 5,
                }),
            ]),
            $el("h2", ["Download"]),
            $checkbox({
                $: (el) => (settings["download-save-description-as-text-file"] = el),
                textContent: "Save model descriptions in .txt files by default.",
            }),
            $el("h2", ["Window"]),
            sidebarControl,
            /*
            $el("div", [
                $el("p", ["Default sidebar width"]),
                $el("input", {
                    $: (el) => (settings["sidebar-default-width"] = el),
                    type: "number",
                    name: "default sidebar width",
                    value: 0.5,
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                }),
            ]),
            $el("div", [
                $el("p", ["Default sidebar height"]),
                $el("input", {
                    $: (el) => (settings["sidebar-default-height"] = el),
                    type: "number",
                    name: "default sidebar height",
                    textContent: "Default sidebar height",
                    value: 0.5,
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                }),
            ]),
            */
            $el("h2", ["Random Tag Generator"]),
            $select({
                $: (el) => (settings["tag-generator-sampler-method"] = el),
                textContent: "Default sampling method",
                options: ["Frequency", "Uniform"],
            }),
            $el("label", [
                "Default count",
                $el("input", {
                    $: (el) => (settings["tag-generator-count"] = el),
                    type: "number",
                    name: "tag generator count",
                    step: 1,
                    min: 1,
                }),
            ]),
            $el("label", [
                "Default minimum threshold",
                $el("input", {
                    $: (el) => (settings["tag-generator-threshold"] = el),
                    type: "number",
                    name: "tag generator threshold",
                    step: 1,
                    min: 1,
                }),
            ]),
        ]);
    }
}

/**
 * @param {String[]} labels
 * @param {[(event: Event) => Promise<void>]} callbacks
 * @returns {HTMLDivElement}
 */
function GenerateRadioButtonGroup(labels, callbacks = []) {
    const RADIO_BUTTON_GROUP_ACTIVE = "radio-button-group-active";
    const radioButtonGroup = $el("div.radio-button-group", []);
    const buttons = [];
    for (let i = 0; i < labels.length; i++) {
        const text = labels[i];
        const callback = callbacks[i] ?? (() => {});
        buttons.push(
            $el("button.radio-button", {
                textContent: text,
                onclick: (event) => {
                    const targetIsActive = event.target.classList.contains(RADIO_BUTTON_GROUP_ACTIVE);
                    if (targetIsActive) {
                        return;
                    }
                    const children = radioButtonGroup.children;
                    for (let i = 0; i < children.length; i++) {
                        children[i].classList.remove(RADIO_BUTTON_GROUP_ACTIVE);
                    }
                    event.target.classList.add(RADIO_BUTTON_GROUP_ACTIVE);
                    callback(event);
                },
            })
        );
    }
    radioButtonGroup.append.apply(radioButtonGroup, buttons);
    buttons[0]?.classList.add(RADIO_BUTTON_GROUP_ACTIVE);
    return radioButtonGroup;
}

/**
 * @param {String[]} labels
 * @param {[(event: Event) => Promise<void>]} activationCallbacks
 * @param {(event: Event) => Promise<void>} deactivationCallback
 * @returns {HTMLDivElement}
 */
function GenerateToggleRadioButtonGroup(labels, activationCallbacks = [], deactivationCallback = () => {}) {
    const RADIO_BUTTON_GROUP_ACTIVE = "radio-button-group-active";
    const radioButtonGroup = $el("div.radio-button-group", []);
    const buttons = [];
    for (let i = 0; i < labels.length; i++) {
        const text = labels[i];
        const activationCallback = activationCallbacks[i] ?? (() => {});
        buttons.push(
            $el("button.radio-button", {
                textContent: text,
                onclick: (event) => {
                    const targetIsActive = event.target.classList.contains(RADIO_BUTTON_GROUP_ACTIVE);
                    const children = radioButtonGroup.children;
                    for (let i = 0; i < children.length; i++) {
                        children[i].classList.remove(RADIO_BUTTON_GROUP_ACTIVE);
                    }
                    if (targetIsActive) {
                        deactivationCallback(event);
                    }
                    else {
                        event.target.classList.add(RADIO_BUTTON_GROUP_ACTIVE);
                        activationCallback(event);
                    }
                },
            })
        );
    }
    radioButtonGroup.append.apply(radioButtonGroup, buttons);
    return radioButtonGroup;
}

/**
 * Coupled-state select and radio buttons (hidden first radio button)
 * @param {String[]} labels
 * @param {[(button: HTMLButtonElement) => Promise<void>]} activationCallbacks
 * @returns {[HTMLDivElement, HTMLSelectElement]}
 */
function GenerateSidebarToggleRadioAndSelect(labels, activationCallbacks = []) {
    const RADIO_BUTTON_GROUP_ACTIVE = "radio-button-group-active";
    const radioButtonGroup = $el("div.radio-button-group", []);
    const buttons = [];
    
    const select = $el("select", {
            name: "sidebar-select",
            onchange: (event) => {
                const select = event.target;
                const children = select.children;
                let value = undefined;
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (child.selected) {
                        value = child.value;
                    }
                }
                for (let i = 0; i < buttons.length; i++) {
                    const button = buttons[i];
                    if (button.textContent === value) {
                        for (let i = 0; i < buttons.length; i++) {
                            buttons[i].classList.remove(RADIO_BUTTON_GROUP_ACTIVE);
                        }
                        button.classList.add(RADIO_BUTTON_GROUP_ACTIVE);
                        activationCallbacks[i](button);
                        break;
                    }
                }
            },
        }, labels.map((option) => {
            return $el("option", {
                value: option,
            }, option);
        })
    );
    
    for (let i = 0; i < labels.length; i++) {
        const text = labels[i];
        const activationCallback = activationCallbacks[i] ?? (() => {});
        buttons.push(
            $el("button.radio-button", {
                textContent: text,
                onclick: (event) => {
                    const button = event.target;
                    let textContent = button.textContent;
                    const targetIsActive = button.classList.contains(RADIO_BUTTON_GROUP_ACTIVE);
                    if (button === buttons[0] && buttons[0].classList.contains(RADIO_BUTTON_GROUP_ACTIVE)) {
                        // do not deactivate 0
                        return;
                    }
                    // update button
                    const children = radioButtonGroup.children;
                    for (let i = 0; i < children.length; i++) {
                        children[i].classList.remove(RADIO_BUTTON_GROUP_ACTIVE);
                    }
                    if (targetIsActive) {
                        // return to 0
                        textContent = labels[0];
                        buttons[0].classList.add(RADIO_BUTTON_GROUP_ACTIVE);
                        activationCallbacks[0](buttons[0]);
                    }
                    else {
                        // move to >0
                        button.classList.add(RADIO_BUTTON_GROUP_ACTIVE);
                        activationCallback(button);
                    }
                    // update selection
                    for (let i = 0; i < select.children.length; i++) {
                        const option = select.children[i];
                        option.selected = option.value === textContent;
                    }
                },
            })
        );
    }
    radioButtonGroup.append.apply(radioButtonGroup, buttons);
    buttons[0].click();
    buttons[0].style.display = "none";
    
    return [radioButtonGroup, select];
}

class ModelManager extends ComfyDialog {
    /** @type {HTMLDivElement} */
    element = null;
    
    /** @type {ModelData} */
    #modelData = null;
    
    /** @type {ModelInfo} */
    #modelInfo = null;
    
    /** @type {DownloadView} */
    #downloadView = null;
    
    /** @type {BrowseView} */
    #browseView = null;
    
    /** @type {SettingsView} */
    #settingsView = null;
    
    /** @type {HTMLDivElement} */
    #topbarRight = null;
    
    /** @type {HTMLDivElement} */
    #tabManagerButtons = null;
    
    /** @type {HTMLDivElement} */
    #tabManagerContents = null;
    
    /** @type {HTMLDivElement} */
    #tabInfoButtons = null;
    
    /** @type {HTMLDivElement} */
    #tabInfoContents = null;
    
    /** @type {HTMLButtonElement} */
    #sidebarButtonGroup = null;
    
    /** @type {HTMLButtonElement} */
    #sidebarSelect = null;
    
    /** @type {HTMLButtonElement} */
    #closeModelInfoButton = null;
    
    constructor() {
        super();
        
        this.#modelData = new ModelData();
        
        this.#settingsView = new SettingsView(
            this.#refreshModels,
            () => this.#updateSidebarButtons(),
        );
        
        this.#modelInfo = new ModelInfo(
            this.#modelData,
            this.#refreshModels,
            this.#settingsView.elements.settings,
        );
        
        this.#browseView = new BrowseView(
            this.#refreshModels,
            this.#modelData,
            this.#showModelInfo,
            this.#resetManagerContentsScroll,
            this.#settingsView.elements.settings, // TODO: decouple settingsData from elements?
        );
        
        this.#downloadView = new DownloadView(
            this.#modelData,
            this.#settingsView.elements.settings,
            this.#refreshModels,
        );
        
        const [tabManagerButtons, tabManagerContents] = GenerateTabGroup([
            { name: "Download", icon: "arrow-collapse-down", tabContent: this.#downloadView.element },
            { name: "Models", icon: "folder-search-outline", tabContent: this.#browseView.element },
            { name: "Settings", icon: "cog-outline", tabContent: this.#settingsView.element },
        ]);
        tabManagerButtons[0]?.click();
        
        const tabInfoButtons = this.#modelInfo.elements.tabButtons;
        const tabInfoContents = this.#modelInfo.elements.tabContents;
        
        const [sidebarButtonGroup, sidebarSelect] = GenerateSidebarToggleRadioAndSelect(
            ["◼", "◨", "⬒", "⬓", "◧"],
            [
                () => { 
                    const element = this.element;
                    if (element) { // callback on initialization as default state
                        element.dataset["sidebarState"] = "none";
                    }
                },
                () => { this.element.dataset["sidebarState"] = "right"; },
                () => { this.element.dataset["sidebarState"] = "top"; },
                () => { this.element.dataset["sidebarState"] = "bottom"; },
                () => { this.element.dataset["sidebarState"] = "left"; },
            ],
        );
        this.#sidebarButtonGroup = sidebarButtonGroup;
        this.#sidebarSelect = sidebarSelect;
        sidebarButtonGroup.classList.add("sidebar-buttons");
        const sidebarButtonGroupChildren = sidebarButtonGroup.children;
        for (let i = 0; i < sidebarButtonGroupChildren.length; i++) {
            sidebarButtonGroupChildren[i].classList.add("icon-button");
        }
        
        const closeModelInfoButton = new ComfyButton({
            icon: "arrow-u-left-bottom",
            tooltip: "Return to model search",
            classList: "comfyui-button icon-button",
            action: async() => await this.#tryHideModelInfo(true),
        }).element;
        this.#closeModelInfoButton = closeModelInfoButton;
        closeModelInfoButton.style.display = "none";
        
        const modelManager = $el(
            "div.comfy-modal.model-manager",
            {
                $: (el) => (this.element = el),
                parent: document.body,
                dataset: { "sidebarState": "none" },
            },
            [
                $el("div.comfy-modal-content", [ // TODO: settings.top_bar_left_to_right or settings.top_bar_right_to_left
                    $el("div.model-manager-panel", [
                        $el("div.model-manager-head", [
                            $el("div.topbar-right", {
                                $: (el) => (this.#topbarRight = el),
                            }, [
                                new ComfyButton({
                                    icon: "window-close",
                                    tooltip: "Close model manager",
                                    classList: "comfyui-button icon-button",
                                    action: async() => {
                                        const saved = await this.#modelInfo.trySave(true);
                                        if (saved) {
                                            this.close();
                                        }
                                    },
                                }).element,
                                closeModelInfoButton,
                                sidebarSelect,
                                sidebarButtonGroup,
                            ]),
                            $el("div.topbar-left", [
                                $el("div", [
                                    $el("div.model-tab-group.no-highlight", {
                                        $: (el) => (this.#tabManagerButtons = el),
                                    }, tabManagerButtons),
                                    $el("div.model-tab-group.no-highlight", {
                                        $: (el) => (this.#tabInfoButtons = el),
                                        style: { display: "none"},
                                    }, tabInfoButtons),
                                ]),
                            ]),
                        ]),
                        $el("div.model-manager-body", [
                            $el("div", {
                                $: (el) => (this.#tabManagerContents = el),
                            }, tabManagerContents),
                            $el("div.tab-contents", {
                                $: (el) => (this.#tabInfoContents = el),
                                style: { display: "none"},
                            }, tabInfoContents),
                        ]),
                    ]),
                ]),
            ]
        );
        
        new ResizeObserver(GenerateDynamicTabTextCallback(modelManager, tabManagerButtons, 704)).observe(modelManager);
        new ResizeObserver(GenerateDynamicTabTextCallback(modelManager, tabInfoButtons, 704)).observe(modelManager);
        new ResizeObserver(() => this.#updateSidebarButtons()).observe(modelManager);
        
        this.#init();
    }
    
    #init() {
        this.#settingsView.reload(false);
        this.#refreshModels();
    }
    
    #resetManagerContentsScroll = () => {
        this.#tabManagerContents.scrollTop = 0;
    }
    
    #refreshModels = async() => {
        const modelData = this.#modelData;
        modelData.systemSeparator = await request("/model-manager/system-separator");
        const newModels = await request("/model-manager/models/list");
        Object.assign(modelData.models, newModels); // NOTE: do NOT create a new object
        const newModelDirectories = await request("/model-manager/models/directory-list");
        modelData.directories.data.splice(0, Infinity, ...newModelDirectories); // NOTE: do NOT create a new array
        
        this.#browseView.updateModelGrid();
        await this.#tryHideModelInfo(false);
        
        document.getElementById("comfy-refresh-button")?.click();
    }
    
    /**
     * @param {searchPath: string}
     * @return {Promise<void>}
     */
    #showModelInfo = async(searchPath) => {
        await this.#modelInfo.update(
            searchPath, 
            this.#refreshModels, 
            this.#modelData.searchSeparator, 
        ).then(() => {
            this.#tabManagerButtons.style.display = "none";
            this.#tabManagerContents.style.display = "none";
            
            this.#closeModelInfoButton.style.display = "";
            this.#tabInfoButtons.style.display = "";
            this.#tabInfoContents.style.display = "";
            
            this.#tabInfoButtons.children[0]?.click();
            this.#modelInfo.show();
            this.#tabInfoContents.scrollTop = 0;
        });
    }
    
    /**
     * @param {boolean} promptSave 
     * @returns {Promise<boolean>}
     */
    #tryHideModelInfo = async(promptSave) => {
        if (this.#tabInfoContents.style.display !== "none") {
            if (!await this.#modelInfo.tryHide(promptSave)) {
                return false;
            }
            
            this.#closeModelInfoButton.style.display = "none";
            this.#tabInfoButtons.style.display = "none";
            this.#tabInfoContents.style.display = "none";
            
            this.#tabManagerButtons.style.display = "";
            this.#tabManagerContents.style.display = "";
        }
        return true;
    }
    
    #updateSidebarButtons = () => {
        const managerRect = document.body.getBoundingClientRect();
        const isNarrow = managerRect.width < 704; // TODO: `minWidth` is a magic value
        const alwaysShowCompactSidebarControls = this.#settingsView.elements.settings["sidebar-control-always-compact"].checked;
        if (isNarrow || alwaysShowCompactSidebarControls) {
            this.#sidebarButtonGroup.style.display = "none";
            this.#sidebarSelect.style.display = "";
        }
        else {
            this.#sidebarButtonGroup.style.display = "";
            this.#sidebarSelect.style.display = "none";
        }
    }
}

/** @type {ModelManager | undefined} */
let instance;

/**
 * @returns {ModelManager}
 */
function getInstance() {
    if (!instance) {
        instance = new ModelManager();
    }
    return instance;
}

const toggleModelManager = () => {
    const modelManager = getInstance();
    const style = modelManager.element.style;
    if (style.display === "" || style.display === "none") {
        modelManager.show();
    }
    else {
        modelManager.close();
    }
};

app.registerExtension({
    name: "Comfy.ModelManager",
    init() {
    },
    async setup() {
        $el("link", {
            parent: document.head,
            rel: "stylesheet",
            href: "./extensions/ComfyUI-Model-Manager/model-manager.css",
        });
        
        app.ui?.menuContainer?.appendChild(
            $el("button", {
                id: "comfyui-model-manager-button",
                parent: document.querySelector(".comfy-menu"),
                textContent: "Models",
                onclick: () => toggleModelManager(),
            })
        );
        
        // [Beta] mobile menu
        app.menu?.settingsGroup?.append(new ComfyButton({
            icon: "folder-search",
            tooltip: "Opens model manager",
            action: () => toggleModelManager(),
            content: "Model Manager",
            popup: getInstance(),
        }));
    },
});
