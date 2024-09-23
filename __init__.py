import os
import io
import pathlib
import shutil
from datetime import datetime
import sys
import copy
import importlib
import re
import base64
import hashlib
import markdownify

from aiohttp import web
import server
import urllib.parse
import urllib.request
import struct
import json
import requests
requests.packages.urllib3.disable_warnings()

import comfy.utils
import folder_paths

comfyui_model_uri = folder_paths.models_dir

extension_uri = os.path.dirname(os.path.abspath(__file__))

config_loader_path = os.path.join(extension_uri, 'config_loader.py')
config_loader_spec = importlib.util.spec_from_file_location('config_loader', config_loader_path)
config_loader = importlib.util.module_from_spec(config_loader_spec)
config_loader_spec.loader.exec_module(config_loader)

no_preview_image = os.path.join(extension_uri, "no-preview.png")
ui_settings_uri = os.path.join(extension_uri, "ui_settings.yaml")
server_settings_uri = os.path.join(extension_uri, "server_settings.yaml")

fallback_model_extensions = set([".bin", ".ckpt", ".gguf", ".onnx", ".pt", ".pth", ".safetensors"]) # TODO: magic values
jpeg_format_names = ["JPG", "JPEG", "JFIF"]
image_extensions = (
    ".png", # order matters
    ".webp", 
    ".jpeg", 
    ".jpg", 
    ".jfif", 
    ".gif", 
    ".apng", 
)
stable_diffusion_webui_civitai_helper_image_extensions = (
    ".preview.png", # order matters
    ".preview.webp", 
    ".preview.jpeg", 
    ".preview.jpg", 
    ".preview.jfif", 
    ".preview.gif", 
    ".preview.apng", 
)
preview_extensions = ( # TODO: JavaScript does not know about this (x2 states)
    image_extensions + # order matters
    stable_diffusion_webui_civitai_helper_image_extensions
)
model_notes_extension = ".txt"
model_info_extension = ".json"
#video_extensions = (".avi", ".mp4", ".webm") # TODO: Requires ffmpeg or cv2. Cache preview frame?

def split_valid_ext(s, *arg_exts):
    sl = s.lower()
    for exts in arg_exts:
        for ext in exts:
            if sl.endswith(ext.lower()):
                return (s[:-len(ext)], ext)
    return (s, "")

_folder_names_and_paths = None # dict[str, tuple[list[str], list[str]]]
def folder_paths_folder_names_and_paths(refresh = False):
    # TODO: "diffusers" extension whitelist is ["folder"]
    global _folder_names_and_paths
    if refresh or _folder_names_and_paths is None:
        _folder_names_and_paths = {}
        for item_name in os.listdir(comfyui_model_uri):
            item_path = os.path.join(comfyui_model_uri, item_name)
            if not os.path.isdir(item_path):
                continue
            if item_name == "configs":
                continue
            if item_name in folder_paths.folder_names_and_paths:
                dir_paths, extensions = copy.deepcopy(folder_paths.folder_names_and_paths[item_name])
            else:
                dir_paths = [item_path]
                extensions = copy.deepcopy(fallback_model_extensions)
            _folder_names_and_paths[item_name] = (dir_paths, extensions)
    return _folder_names_and_paths

def folder_paths_get_folder_paths(folder_name, refresh = False): # API function crashes querying unknown model folder
    paths = folder_paths_folder_names_and_paths(refresh)
    if folder_name in paths:
        return paths[folder_name][0]

    maybe_path = os.path.join(comfyui_model_uri, folder_name)
    if os.path.exists(maybe_path):
        return [maybe_path]
    return []

def folder_paths_get_supported_pt_extensions(folder_name, refresh = False): # Missing API function
    paths = folder_paths_folder_names_and_paths(refresh)
    if folder_name in paths:
        return paths[folder_name][1]
    model_extensions = copy.deepcopy(fallback_model_extensions)
    return model_extensions


def search_path_to_system_path(model_path):
    sep = os.path.sep
    model_path = os.path.normpath(model_path.replace("/", sep))
    model_path = model_path.lstrip(sep)

    isep1 = model_path.find(sep, 0)
    if isep1 == -1 or isep1 == len(model_path):
        return (None, None)

    isep2 = model_path.find(sep, isep1 + 1)
    if isep2 == -1 or isep2 - isep1 == 1:
        isep2 = len(model_path)

    model_path_type = model_path[0:isep1]
    paths = folder_paths_get_folder_paths(model_path_type)
    if len(paths) == 0:
        return (None, None)

    model_path_index = model_path[isep1 + 1:isep2]
    try:
        model_path_index = int(model_path_index)
    except:
        return (None, None)
    if model_path_index < 0 or model_path_index >= len(paths):
        return (None, None)

    system_path = os.path.normpath(
        paths[model_path_index] + 
        sep + 
        model_path[isep2:]
    )

    return (system_path, model_path_type)


def get_safetensor_header(path):
    try:
        header_bytes = comfy.utils.safetensors_header(path)
        header_json = json.loads(header_bytes)
        return header_json if header_json is not None else {}
    except:
        return {}


def end_swap_and_pop(x, i):
    x[i], x[-1] = x[-1], x[i]
    return x.pop(-1)


def model_type_to_dir_name(model_type):
    if model_type == "checkpoint": return "checkpoints"
    #elif model_type == "clip": return "clip"
    #elif model_type == "clip_vision": return "clip_vision"
    #elif model_type == "controlnet": return "controlnet"
    elif model_type == "diffuser": return "diffusers"
    elif model_type == "embedding": return "embeddings"
    #elif model_type== "gligen": return "gligen"
    elif model_type == "hypernetwork": return "hypernetworks"
    elif model_type == "lora": return "loras"
    #elif model_type == "style_models": return "style_models"
    #elif model_type == "unet": return "unet"
    elif model_type == "upscale_model": return "upscale_models"
    #elif model_type == "vae": return "vae"
    #elif model_type == "vae_approx": return "vae_approx"
    else: return model_type


def ui_rules():
    Rule = config_loader.Rule
    return [
        Rule("model-search-always-append", "", str),
        Rule("model-default-browser-model-type", "checkpoints", str),
        Rule("model-real-time-search", True, bool),
        Rule("model-persistent-search", True, bool),
        
        Rule("model-preview-thumbnail-type", "AUTO", str),
        Rule("model-preview-fallback-search-safetensors-thumbnail", False, bool),
        Rule("model-show-label-extensions", False, bool),
        Rule("model-show-add-button", True, bool),
        Rule("model-show-copy-button", True, bool),
        Rule("model-show-load-workflow-button", True, bool),
        Rule("model-show-open-model-url-button", False, bool),
        Rule("model-info-button-on-left", False, bool),
        
        Rule("model-add-embedding-extension", False, bool),
        Rule("model-add-drag-strict-on-field", False, bool),
        Rule("model-add-offset", 25, int),
        
        Rule("model-info-autosave-notes", False, bool),
        
        Rule("download-save-description-as-text-file", True, bool),
        
        Rule("sidebar-control-always-compact", False, bool),
        Rule("sidebar-default-width", 0.5, float, 0.0, 1.0),
        Rule("sidebar-default-height", 0.5, float, 0.0, 1.0),
        Rule("sidebar-default-state", "None", str),
        Rule("text-input-always-hide-search-button", False, bool),
        Rule("text-input-always-hide-clear-button", False, bool),
        
        Rule("tag-generator-sampler-method", "Frequency", str),
        Rule("tag-generator-count", 10, int),
        Rule("tag-generator-threshold", 2, int),
    ]


def server_rules():
    Rule = config_loader.Rule
    return [
        #Rule("model_extension_download_whitelist", [".safetensors"], list),
        Rule("civitai_api_key", "", str),
        Rule("huggingface_api_key", "", str),
    ]
server_settings = config_loader.yaml_load(server_settings_uri, server_rules())
config_loader.yaml_save(server_settings_uri, server_rules(), server_settings)


def get_def_headers(url=""):
    def_headers = {
        "User-Agent": "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    }

    if url.startswith("https://civitai.com/"):
        api_key = server_settings["civitai_api_key"]
        if (api_key != ""):
            def_headers["Content-Type"] = f"application/json"
            def_headers["Authorization"] = f"Bearer {api_key}"
            url += "&" if "?" in url else "?" # not the most robust solution
            url += f"token={api_key}" # TODO: Authorization didn't work in the header
    elif url.startswith("https://huggingface.co/"):
        api_key = server_settings["huggingface_api_key"]
        if api_key != "":
            def_headers["Authorization"] = f"Bearer {api_key}"
    
    return def_headers


def save_web_url(path, url):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"[InternetShortcut]\nURL={url}\n")


def try_load_web_url(path):
    with open(path, "r", encoding="utf-8") as f:
        if f.readline() != "[InternetShortcut]\n": return ""
        url = f.readline()
        if not url.startswith("URL="): return ""
        if not url.endswith("\n"): return ""
        return url[4:len(url)-1]


def hash_file(path, buffer_size=1024*1024):
    sha256 = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            data = f.read(buffer_size)
            if not data: break
            sha256.update(data)
    return sha256.hexdigest()


class Civitai:
    IMAGE_URL_SUBDIRECTORY_PREFIX = "https://civitai.com/images/"
    IMAGE_URL_DOMAIN_PREFIX = "'https://image.civitai.com/"

    @staticmethod
    def image_subdirectory_url_to_image_url(image_url):
        url_suffix = image_url[len(Civitai.IMAGE_URL_SUBDIRECTORY_PREFIX):]
        image_id = re.search(r"^\d+", url_suffix).group(0)
        image_id = str(int(image_id))
        image_info_url = f"https://civitai.com/api/v1/images?imageId={image_id}"
        def_headers = get_def_headers(image_info_url)
        response = requests.get(
            url=image_info_url, 
            stream=False, 
            verify=False, 
            headers=def_headers, 
            proxies=None, 
            allow_redirects=False, 
        )
        if response.ok:
            #content_type = response.headers.get("Content-Type")
            info = response.json()
            items = info["items"]
            if len(items) == 0:
                raise RuntimeError("Civitai /api/v1/images returned 0 items!")
            return items[0]["url"]
        else:
            raise RuntimeError("Bad response from api/v1/images!")

    @staticmethod
    def image_domain_url_full_size(url, width = None):
        result = re.search("/width=(\d+)", url)
        if width is None:
            i0 = result.span()[0]
            i1 = result.span()[1]
            return url[0:i0] + url[i1:]
        else:
            w = int(result.group(1))
            return url.replace(str(w), str(width))

    @staticmethod
    def search_by_hash(sha256_hash):
        url_api_hash = r"https://civitai.com/api/v1/model-versions/by-hash/" + sha256_hash
        hash_response = requests.get(url_api_hash)
        if hash_response.status_code != 200:
            return {}
        return hash_response.json() # model version info

    @staticmethod
    def search_by_model_id(model_id):
        url_api_model = r"https://civitai.com/api/v1/models/" + str(model_id)
        model_response = requests.get(url_api_model)
        if model_response.status_code != 200:
            return {}
        return model_response.json() # model group info

    @staticmethod
    def get_model_url(model_version_info):
        if len(model_version_info) == 0: return ""
        model_id = model_version_info.get("modelId")
        if model_id is None:
            # there can be incomplete model info, so don't throw just in case
            return ""
        url = f"https://civitai.com/models/{model_id}"
        version_id = model_version_info.get("id")
        if version_id is not None:
            url += f"?modelVersionId={version_id}"
        return url

    @staticmethod
    def get_preview_urls(model_version_info, full_size=False):
        images = model_version_info.get("images", None)
        if images is None:
            return []
        preview_urls = []
        for image_info in images:
            url = image_info["url"]
            if full_size:
                url = Civitai.image_domain_url_full_size(url, image_info.get("width", None))
            preview_urls.append(url)
        return preview_urls

    @staticmethod
    def search_notes(model_version_info):
        if len(model_version_info) == 0:
            return ""
        model_name = None
        if "modelId" in model_version_info and "id" in model_version_info:
            model_id = model_version_info.get("modelId")
            model_version_id = model_version_info.get("id")

            model_version_description = ""
            model_trigger_words = []
            model_info = Civitai.search_by_model_id(model_id)
            if len(model_info) == 0: # can happen if model download is disabled
                print("Model Manager WARNING: Unable to find Civitai 'modelId' " + str(model_id) + ". Try deleting .json file and trying again later!")
                return ""
            model_name = model_info.get("name")
            model_description = model_info.get("description")
            for model_version in model_info["modelVersions"]:
                if model_version["id"] == model_version_id:
                    model_version_description = model_version.get("description")
                    model_trigger_words = model_version.get("trainedWords")
                    break
        elif "description" in model_version_info and "activation text" in model_version_info and "notes" in model_version_info:
            # {'description': str, 'sd version': str, 'activation text': str, 'preferred weight': int, 'notes': str}
            model_description = model_version_info.get("description")
            activation_text = model_version_info.get("activation text")
            if activation_text != "":
                model_trigger_words = [activation_text]
            else:
                model_trigger_words = []
            model_version_description = model_version_info.get("notes")
        else:
            return ""
        model_description = model_description if model_description is not None else ""
        model_trigger_words = model_trigger_words if model_trigger_words is not None else []
        model_version_description = model_version_description if model_version_description is not None else ""
        model_name = model_name if model_name is not None else "Model Description"

        notes = ""
        if len(model_trigger_words) > 0:
            notes += "# Trigger Words\n\n"
            model_trigger_words = [re.sub(",$", "", s.strip()) for s in model_trigger_words]
            join_separator = ', '
            for s in model_trigger_words:
                if ',' in s:
                    join_separator = '\n'
                    break
            if join_separator == '\n':
                model_trigger_words = ["* " + s for s in model_trigger_words]
            notes += join_separator.join(model_trigger_words)
        if model_version_description != "":
            if len(notes) > 0: notes += "\n\n"
            notes += "# About this version\n\n"
            notes += markdownify.markdownify(model_version_description)
        if model_description != "":
            if len(notes) > 0: notes += "\n\n"
            notes += "# " + model_name + "\n\n"
            notes += markdownify.markdownify(model_description)
        return notes.strip()


class ModelInfo:
    @staticmethod
    def search_by_hash(sha256_hash):
        model_info = Civitai.search_by_hash(sha256_hash)
        if len(model_info) > 0: return model_info
        # TODO: search other websites
        return {}

    @staticmethod
    def try_load_cached(model_path):
        model_info_path = os.path.splitext(model_path)[0] + model_info_extension
        if os.path.isfile(model_info_path):
            with open(model_info_path, "r", encoding="utf-8") as f:
                model_info = json.load(f)
                return model_info
        return {}

    @staticmethod
    def get_hash(model_info):
        model_info = Civitai.get_hash(model_info)
        if len(model_info) > 0: return model_info
        # TODO: search other websites
        return {}

    @staticmethod
    def search_info(model_path, cache=True, use_cached=True):
        model_info = ModelInfo.try_load_cached(model_path)
        if use_cached and len(model_info) > 0:
            return model_info

        sha256_hash = hash_file(model_path)
        model_info = ModelInfo.search_by_hash(sha256_hash)
        if cache and len(model_info) > 0:
            model_info_path = os.path.splitext(model_path)[0] + model_info_extension
            with open(model_info_path, "w", encoding="utf-8") as f:
                json.dump(model_info, f, indent=4)
                print("Saved file: " + model_info_path)

        return model_info

    @staticmethod
    def get_url(model_info):
        if len(model_info) == 0:
            return ""
        model_url = Civitai.get_model_url(model_info)
        if model_url != "":
            return model_url
        # TODO: huggingface has <user>/<model> formats
        # TODO: support other websites
        return ""

    @staticmethod
    def search_notes(model_path):
        assert(os.path.isfile(model_path))
        model_info = ModelInfo.search_info(model_path, cache=True, use_cached=True) # assume cached is correct; re-download elsewhere
        if len(model_info) == 0:
            return ""
        notes = Civitai.search_notes(model_info)
        if len(notes) > 0 and not notes.isspace():
            return notes
        # TODO: search other websites
        return ""

    @staticmethod
    def get_web_preview_urls(model_info, full_size=False):
        if len(model_info) == 0:
            return []
        preview_urls = Civitai.get_preview_urls(model_info, full_size)
        if len(preview_urls) > 0:
            return preview_urls
        # TODO: support other websites
        return []

@server.PromptServer.instance.routes.get("/model-manager/timestamp")
async def get_timestamp(request):
    return web.json_response({ "timestamp": datetime.now().timestamp() })


@server.PromptServer.instance.routes.get("/model-manager/settings/load")
async def load_ui_settings(request):
    rules = ui_rules()
    settings = config_loader.yaml_load(ui_settings_uri, rules)
    return web.json_response({ "settings": settings })


@server.PromptServer.instance.routes.post("/model-manager/settings/save")
async def save_ui_settings(request):
    body = await request.json()
    settings = body.get("settings")
    rules = ui_rules()
    validated_settings = config_loader.validated(rules, settings)
    success = config_loader.yaml_save(ui_settings_uri, rules, validated_settings)
    print("Saved file: " + ui_settings_uri)
    return web.json_response({
        "success": success,
        "settings": validated_settings if success else "",
    })


from PIL import Image, TiffImagePlugin
from PIL.PngImagePlugin import PngInfo
def PIL_cast_serializable(v):
    # source: https://github.com/python-pillow/Pillow/issues/6199#issuecomment-1214854558
    if isinstance(v, TiffImagePlugin.IFDRational):
        return float(v)
    elif isinstance(v, tuple):
        return tuple(PIL_cast_serializable(t) for t in v)
    elif isinstance(v, bytes):
        return v.decode(errors="replace")
    elif isinstance(v, dict):
        for kk, vv in v.items():
            v[kk] = PIL_cast_serializable(vv)
        return v
    else:
        return v


def get_safetensors_image_bytes(path):
    if not os.path.isfile(path):
        raise RuntimeError("Path was invalid!")
    header = get_safetensor_header(path)
    metadata = header.get("__metadata__", None)
    if metadata is None:
        return None
    thumbnail = metadata.get("modelspec.thumbnail", None)
    if thumbnail is None:
        return None
    image_data = thumbnail.split(',')[1]
    return base64.b64decode(image_data)


def get_image_info(image):
    metadata = None
    if len(image.info) > 0:
        metadata = PngInfo()
        for (key, value) in image.info.items():
            value_str = str(PIL_cast_serializable(value)) # not sure if this is correct (sometimes includes exif)
            metadata.add_text(key, value_str)
    return metadata


def image_format_is_equal(f1, f2):
    if not isinstance(f1, str) or not isinstance(f2, str):
        return False
    if f1[0] == ".": f1 = f1[1:]
    if f2[0] == ".": f2 = f2[1:]
    f1 = f1.upper()
    f2 = f2.upper()
    return f1 == f2 or (f1 in jpeg_format_names and f2 in jpeg_format_names)


def get_auto_thumbnail_format(original_format):
    if original_format in ["JPEG", "WEBP", "JPG"]: # JFIF?
        return original_format
    return "JPEG" # default fallback


@server.PromptServer.instance.routes.get("/model-manager/preview/get/{uri}")
async def get_model_preview(request):
    uri = request.match_info["uri"]
    if uri is None: # BUG: this should never happen
        print(f"Invalid uri! Request url: {request.url}")
        uri = "no-preview"
    quality = 75
    response_image_format = request.query.get("image-format", None)
    if isinstance(response_image_format, str):
        response_image_format = response_image_format.upper()

    image_path = no_preview_image
    file_name = os.path.split(no_preview_image)[1]
    if uri != "no-preview":
        sep = os.path.sep
        uri = uri.replace("/" if sep == "\\" else "/", sep)
        path, _ = search_path_to_system_path(uri)
        head, extension = split_valid_ext(path, preview_extensions)
        if os.path.exists(path):
            image_path = path
            file_name = os.path.split(head)[1] + extension
        elif os.path.exists(head) and head.endswith(".safetensors"):
            image_path = head
            file_name = os.path.splitext(os.path.split(head)[1])[0] + extension

    w = request.query.get("width")
    h = request.query.get("height")
    try:
        w = int(w)
        if w < 1:
            w = None
    except:
        w = None
    try:
        h = int(h)
        if w < 1:
            h = None
    except:
        h = None

    image_data = None
    if w is None and h is None: # full size
        if image_path.endswith(".safetensors"):
            image_data = get_safetensors_image_bytes(image_path)
        else:
            with open(image_path, "rb") as image:
                image_data = image.read()
        fp = io.BytesIO(image_data)
        with Image.open(fp) as image:
            image_format = image.format
            if response_image_format is None:
                response_image_format = image_format
            elif response_image_format == "AUTO":
                response_image_format = get_auto_thumbnail_format(image_format)

            if not image_format_is_equal(response_image_format, image_format):
                exif = image.getexif()
                metadata = get_image_info(image)
                if response_image_format in jpeg_format_names:
                    image = image.convert('RGB')
                image_bytes = io.BytesIO()
                image.save(image_bytes, format=response_image_format, exif=exif, pnginfo=metadata, quality=quality)
                image_data = image_bytes.getvalue()
    else:
        if image_path.endswith(".safetensors"):
            image_data = get_safetensors_image_bytes(image_path)
            fp = io.BytesIO(image_data)
        else:
            fp = image_path

        with Image.open(fp) as image:
            image_format = image.format
            if response_image_format is None:
                response_image_format = image_format
            elif response_image_format == "AUTO":
                response_image_format = get_auto_thumbnail_format(image_format)

            w0, h0 = image.size
            if w is None:
                w = (h * w0) // h0
            elif h is None:
                h = (w * h0) // w0

            exif = image.getexif()
            metadata = get_image_info(image)

            ratio_original = w0 / h0
            ratio_thumbnail = w / h
            if abs(ratio_original - ratio_thumbnail) < 0.01:
                crop_box = (0, 0, w0, h0)
            elif ratio_original > ratio_thumbnail:
                crop_width_fp = h0 * w / h
                x0 = int((w0 - crop_width_fp) / 2)
                crop_box = (x0, 0, x0 + int(crop_width_fp), h0)
            else:
                crop_height_fp = w0 * h / w
                y0 = int((h0 - crop_height_fp) / 2)
                crop_box = (0, y0, w0, y0 + int(crop_height_fp))
            image = image.crop(crop_box)

            if w < w0 and h < h0:
                resampling_method = Image.Resampling.BOX
            else:
                resampling_method = Image.Resampling.BICUBIC
            image.thumbnail((w, h), resample=resampling_method)

            if not image_format_is_equal(image_format, response_image_format) and response_image_format in jpeg_format_names:
                image = image.convert('RGB')
            image_bytes = io.BytesIO()
            image.save(image_bytes, format=response_image_format, exif=exif, pnginfo=metadata, quality=quality)
            image_data = image_bytes.getvalue()

    response_file_name = os.path.splitext(file_name)[0] + '.' + response_image_format.lower()
    return web.Response(
        headers={
            "Content-Disposition": f"inline; filename={response_file_name}",
        },
        body=image_data,
        content_type="image/" + response_image_format.lower(),
    )


@server.PromptServer.instance.routes.get("/model-manager/image/extensions")
async def get_image_extensions(request):
    return web.json_response(image_extensions)


def download_model_preview(path, image, overwrite):
    if not os.path.isfile(path):
        raise ValueError("Invalid path!")
    path_without_extension = os.path.splitext(path)[0]

    if type(image) is str:
        if image.startswith(Civitai.IMAGE_URL_SUBDIRECTORY_PREFIX):
            image = Civitai.image_subdirectory_url_to_image_url(image)
        if image.startswith(Civitai.IMAGE_URL_DOMAIN_PREFIX):
            image = Civitai.image_domain_url_full_size(image)
        _, image_extension = split_valid_ext(image, image_extensions)
        if image_extension == "":
            raise ValueError("Invalid image type!")
        image_path = path_without_extension + image_extension
        download_file(image, image_path, overwrite)
    else:
        content_type = image.content_type
        if not content_type.startswith("image/"):
            raise RuntimeError("Invalid content type!")
        image_extension = "." + content_type[len("image/"):]
        if image_extension not in image_extensions:
            raise RuntimeError("Invalid extension!")

        image_path = path_without_extension + image_extension
        if not overwrite and os.path.isfile(image_path):
            raise RuntimeError("Image already exists!")
        file: io.IOBase = image.file
        image_data = file.read()
        with open(image_path, "wb") as f:
            f.write(image_data)
        print("Saved file: " + image_path)

    if overwrite:
        delete_same_name_files(path_without_extension, preview_extensions, image_extension)

    # detect (and try to fix) wrong file extension
    image_format = None
    try:
        with Image.open(image_path) as image:
            image_format = image.format
        image_dir_and_name, image_ext = os.path.splitext(image_path)
        if not image_format_is_equal(image_format, image_ext):
            corrected_image_path = image_dir_and_name + "." + image_format.lower()
            if os.path.exists(corrected_image_path) and not overwrite:
                print("WARNING: '" + image_path + "' has wrong extension!")
            else:
                os.rename(image_path, corrected_image_path)
                print("Saved file: " + corrected_image_path)
                image_path = corrected_image_path
    except Image.UnidentifiedImageError as e: #TODO: handle case where "image" is actually video
        print("WARNING: '" + image_path + "' image format was unknown!")
        os.remove(image_path)
        print("Deleted file: " + image_path)
        image_path = ""
    return image_path # return in-case need corrected path


@server.PromptServer.instance.routes.post("/model-manager/preview/set")
async def set_model_preview(request):
    formdata = await request.post()
    try:
        search_path = formdata.get("path", None)
        model_path, model_type = search_path_to_system_path(search_path)

        image = formdata.get("image", None)

        overwrite = formdata.get("overwrite", "true").lower()
        overwrite = True if overwrite == "true" else False

        download_model_preview(model_path, image, overwrite)
        return web.json_response({ "success": True })
    except ValueError as e:
        print(e, file=sys.stderr, flush=True)
        return web.json_response({
            "success": False,
            "alert": "Failed to set preview!\n\n" + str(e),
        })


@server.PromptServer.instance.routes.post("/model-manager/preview/delete")
async def delete_model_preview(request):
    result = { "success": False }
    
    model_path = request.query.get("path", None)
    if model_path is None:
        result["alert"] = "Missing model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)

    model_path, model_type = search_path_to_system_path(model_path)
    model_extensions = folder_paths_get_supported_pt_extensions(model_type)
    path_and_name, _ = split_valid_ext(model_path, model_extensions)
    delete_same_name_files(path_and_name, preview_extensions)

    result["success"] = True
    return web.json_response(result)


def correct_image_extensions(root_dir):
    detected_image_count = 0
    corrected_image_count = 0
    for root, dirs, files in os.walk(root_dir):
        for file_name in files:
            file_path = root + os.path.sep + file_name
            image_format = None
            try:
                with Image.open(file_path) as image:
                    image_format = image.format
            except:
                continue
            image_path = file_path
            image_dir_and_name, image_ext = os.path.splitext(image_path)
            if not image_format_is_equal(image_format, image_ext):
                detected_image_count += 1
                corrected_image_path = image_dir_and_name + "." + image_format.lower()
                if os.path.exists(corrected_image_path):
                    print("WARNING: '" + image_path + "' has wrong extension!")
                else:
                    try:
                        os.rename(image_path, corrected_image_path)
                    except:
                        print("WARNING: Unable to rename '" + image_path + "'!")
                        continue
                    ext0 = os.path.splitext(image_path)[1]
                    ext1 = os.path.splitext(corrected_image_path)[1]
                    print(f"({ext0} -> {ext1}): {corrected_image_path}")
                    corrected_image_count += 1
    return (detected_image_count, corrected_image_count)


@server.PromptServer.instance.routes.get("/model-manager/preview/correct-extensions")
async def correct_preview_extensions(request):
    result = { "success": False }

    detected = 0
    corrected = 0

    model_types = os.listdir(comfyui_model_uri)
    model_types.remove("configs")
    model_types.sort()

    for model_type in model_types:
        for base_path_index, model_base_path in enumerate(folder_paths_get_folder_paths(model_type)):
            if not os.path.exists(model_base_path): # TODO: Bug in main code? ("ComfyUI\output\checkpoints", "ComfyUI\output\clip", "ComfyUI\models\t2i_adapter", "ComfyUI\output\vae")
                continue
            d, c = correct_image_extensions(model_base_path)
            detected += d
            corrected += c

    result["success"] = True
    result["detected"] = detected
    result["corrected"] = corrected
    return web.json_response(result)


@server.PromptServer.instance.routes.get("/model-manager/models/list")
async def get_model_list(request):
    use_safetensor_thumbnail = (
        config_loader.yaml_load(ui_settings_uri, ui_rules())
        .get("model-preview-fallback-search-safetensors-thumbnail", False)
    )

    model_types = os.listdir(comfyui_model_uri)
    model_types.remove("configs")
    model_types.sort()

    models = {}
    for model_type in model_types:
        model_extensions = tuple(folder_paths_get_supported_pt_extensions(model_type))
        file_infos = []
        for base_path_index, model_base_path in enumerate(folder_paths_get_folder_paths(model_type)):
            if not os.path.exists(model_base_path): # TODO: Bug in main code? ("ComfyUI\output\checkpoints", "ComfyUI\output\clip", "ComfyUI\models\t2i_adapter", "ComfyUI\output\vae")
                continue
            for cwd, subdirs, files in os.walk(model_base_path):
                dir_models = []
                dir_images = []

                for file in files:
                    if file.lower().endswith(model_extensions):
                        dir_models.append(file)
                    elif file.lower().endswith(preview_extensions):
                        dir_images.append(file)

                for model in dir_models:
                    model_name, model_ext = split_valid_ext(model, model_extensions)
                    image = None
                    image_modified = None
                    for ext in preview_extensions: # order matters
                        for iImage in range(len(dir_images)-1, -1, -1):
                            image_name = dir_images[iImage]
                            if not image_name.lower().endswith(ext.lower()):
                                continue
                            image_name = image_name[:-len(ext)]
                            if model_name == image_name:
                                image = end_swap_and_pop(dir_images, iImage)
                                img_abs_path = os.path.join(cwd, image)
                                image_modified = pathlib.Path(img_abs_path).stat().st_mtime_ns
                                break
                        if image is not None:
                            break
                    abs_path = os.path.join(cwd, model)
                    stats = pathlib.Path(abs_path).stat()
                    sizeBytes = stats.st_size
                    model_modified = stats.st_mtime_ns
                    model_created = stats.st_ctime_ns
                    if use_safetensor_thumbnail and image is None and model_ext == ".safetensors":
                        # try to fallback on safetensor embedded thumbnail
                        header = get_safetensor_header(abs_path)
                        metadata = header.get("__metadata__", None)
                        if metadata is not None:
                            thumbnail = metadata.get("modelspec.thumbnail", None)
                            if thumbnail is not None:
                                i0 = thumbnail.find("/") + 1
                                i1 = thumbnail.find(";")
                                image_ext = "." + thumbnail[i0:i1]
                                if image_ext in image_extensions:
                                    image = model + image_ext
                                    image_modified = model_modified
                    rel_path = "" if cwd == model_base_path else os.path.relpath(cwd, model_base_path)
                    info = (
                        model, 
                        image, 
                        base_path_index, 
                        rel_path, 
                        model_modified,
                        model_created, 
                        image_modified, 
                        sizeBytes, 
                    )
                    file_infos.append(info)
        #file_infos.sort(key=lambda tup: tup[4], reverse=True) # TODO: remove sort; sorted on client

        model_items = []
        for model, image, base_path_index, rel_path, model_modified, model_created, image_modified, sizeBytes in file_infos:
            item = {
                "name": model,
                "path": "/" + os.path.join(model_type, str(base_path_index), rel_path, model).replace(os.path.sep, "/"), # relative logical path
                #"systemPath": os.path.join(rel_path, model), # relative system path (less information than "search path")
                "dateModified": model_modified,
                "dateCreated": model_created,
                #"dateLastUsed": "", # TODO: track server-side, send increment client-side
                #"countUsed": 0, # TODO: track server-side, send increment client-side
                "sizeBytes": sizeBytes,
            }
            if image is not None:
                raw_post = os.path.join(model_type, str(base_path_index), rel_path, image)
                item["preview"] = {
                    "path": raw_post,
                    "dateModified": str(image_modified),
                }
            model_items.append(item)

        models[model_type] = model_items

    return web.json_response(models)


def linear_directory_hierarchy(refresh = False):
    model_paths = folder_paths_folder_names_and_paths(refresh)
    dir_list = []
    dir_list.append({ "name": "", "childIndex": 1, "childCount": len(model_paths) })
    for model_dir_name, (model_dirs, _) in model_paths.items():
        dir_list.append({ "name": model_dir_name, "childIndex": None, "childCount": len(model_dirs) })
    for model_dir_index, (_, (model_dirs, extension_whitelist)) in enumerate(model_paths.items()):
        model_dir_child_index = len(dir_list)
        dir_list[model_dir_index + 1]["childIndex"] = model_dir_child_index
        for dir_path_index, dir_path in enumerate(model_dirs):
            dir_list.append({ "name": str(dir_path_index), "childIndex": None, "childCount": None })
        for dir_path_index, dir_path in enumerate(model_dirs):
            if not os.path.exists(dir_path) or os.path.isfile(dir_path):
                continue
            
            #dir_list.append({ "name": str(dir_path_index), "childIndex": None, "childCount": 0 })
            dir_stack = [(dir_path, model_dir_child_index + dir_path_index)]
            while len(dir_stack) > 0: # DEPTH-FIRST
                dir_path, dir_index = dir_stack.pop()
                
                dir_items = os.listdir(dir_path)
                dir_items = sorted(dir_items, key=str.casefold)
                
                dir_child_count = 0
                
                # TODO: sort content of directory: alphabetically
                # TODO: sort content of directory: files first
                
                subdirs = []
                for item_name in dir_items: # BREADTH-FIRST
                    item_path = os.path.join(dir_path, item_name)
                    if os.path.isdir(item_path):
                        # dir
                        subdir_index = len(dir_list) # this must be done BEFORE `dir_list.append`
                        subdirs.append((item_path, subdir_index))
                        dir_list.append({ "name": item_name, "childIndex": None, "childCount": 0 })
                        dir_child_count += 1
                    else:
                        # file
                        if extension_whitelist is None or split_valid_ext(item_name, extension_whitelist)[1] != "":
                            dir_list.append({ "name": item_name })
                            dir_child_count += 1
                if dir_child_count > 0:
                    dir_list[dir_index]["childIndex"] = len(dir_list) - dir_child_count
                dir_list[dir_index]["childCount"] = dir_child_count
                subdirs.reverse()
                for dir_path, subdir_index in subdirs:
                    dir_stack.append((dir_path, subdir_index))
    return dir_list


@server.PromptServer.instance.routes.get("/model-manager/models/directory-list")
async def get_directory_list(request):
    #body = await request.json()
    dir_list = linear_directory_hierarchy(True)
    #json.dump(dir_list, sys.stdout, indent=4)
    return web.json_response(dir_list)


def try_download_and_save_model_info(model_file_path):
    success = (0, 0, 0) #info, notes, url
    head, _ = os.path.splitext(model_file_path)
    model_info_path = head + model_info_extension
    model_notes_path = head + model_notes_extension
    model_url_path = head + ".url"
    if os.path.exists(model_info_path) and os.path.exists(model_notes_path) and os.path.exists(model_url_path):
        return success
    print("Scanning " + model_file_path)

    model_info = {}
    model_info = ModelInfo.search_info(model_file_path, cache=True, use_cached=True)
    if len(model_info) == 0:
        return success
    success[0] = 1

    if not os.path.exists(model_notes_path):
        notes = ModelInfo.search_notes(model_file_path)
        if not notes.isspace() and notes != "":
            try:
                with open(model_notes_path, "w", encoding="utf-8") as f:
                    f.write(notes)
                print("Saved file: " + model_notes_path)
                success[1] = 1
            except Exception as e:
                print(f"Failed to save {model_notes_path}!")
                print(e, file=sys.stderr, flush=True)

    if not os.path.exists(model_url_path):
        web_url = ModelInfo.get_url(model_info)
        if web_url is not None and web_url != "":
            try:
                save_web_url(model_url_path, web_url)
                print("Saved file: " + model_url_path)
                success[2] = 1
            except Exception as e:
                print(f"Failed to save {model_url_path}!")
                print(e, file=sys.stderr, flush=True)
    return success


@server.PromptServer.instance.routes.post("/model-manager/models/scan")
async def try_scan_download(request):
    refresh = request.query.get("refresh", None) is not None
    response = {
        "success": False,
        "infoCount": 0,
        "notesCount": 0,
        "urlCount": 0,
    }
    model_paths = folder_paths_folder_names_and_paths(refresh)
    for _, (model_dirs, model_extension_whitelist) in model_paths.items():
        for root_dir in model_dirs:
            for root, dirs, files in os.walk(root_dir):
                for file in files:
                    file_name, file_extension = os.path.splitext(file)
                    if file_extension not in model_extension_whitelist:
                        continue
                    model_file_path = root + os.path.sep + file
                    savedInfo, savedNotes, savedUrl = try_download_and_save_model_info(model_file_path)
                    response["infoCount"] += savedInfo
                    response["notesCount"] += savedNotes
                    response["urlCount"] += savedUrl

    response["success"] = True
    return web.json_response(response)

@server.PromptServer.instance.routes.post("/model-manager/preview/scan")
async def try_scan_download_previews(request):
    refresh = request.query.get("refresh", None) is not None
    response = {
        "success": False,
        "count": 0,
    }
    model_paths = folder_paths_folder_names_and_paths(refresh)
    for _, (model_dirs, model_extension_whitelist) in model_paths.items():
        for root_dir in model_dirs:
            for root, dirs, files in os.walk(root_dir):
                for file in files:
                    file_name, file_extension = os.path.splitext(file)
                    if file_extension not in model_extension_whitelist:
                        continue
                    model_file_path = root + os.path.sep + file
                    model_file_head = os.path.splitext(model_file_path)[0]

                    preview_exists = False
                    for preview_extension in preview_extensions:
                        preview_path = model_file_head + preview_extension
                        if os.path.isfile(preview_path):
                            preview_exists = True
                            break
                    if preview_exists:
                        continue

                    model_info = ModelInfo.try_load_cached(model_file_path) # NOTE: model info must already be downloaded
                    web_previews = ModelInfo.get_web_preview_urls(model_info, True)
                    if len(web_previews) == 0:
                        continue
                    saved_image_path = download_model_preview(
                        model_file_path,
                        image=web_previews[0],
                        overwrite=False,
                    )
                    if os.path.isfile(saved_image_path):
                        response["count"] += 1

    response["success"] = True
    return web.json_response(response)


def download_file(url, filename, overwrite):
    if not overwrite and os.path.isfile(filename):
        raise ValueError("File already exists!")

    filename_temp = filename + ".download"

    def_headers = get_def_headers(url)
    rh = requests.get(
        url=url, 
        stream=True, 
        verify=False, 
        headers=def_headers, 
        proxies=None, 
        allow_redirects=False, 
    )
    if not rh.ok:
        raise ValueError(
            "Unable to download! Request header status code: " + 
            str(rh.status_code)
        )

    downloaded_size = 0
    if rh.status_code == 200 and os.path.exists(filename_temp):
        downloaded_size = os.path.getsize(filename_temp)

    headers = {"Range": "bytes=%d-" % downloaded_size}
    headers["User-Agent"] = def_headers["User-Agent"]
    headers["Authorization"] = def_headers.get("Authorization", None)

    r = requests.get(
        url=url, 
        stream=True, 
        verify=False, 
        headers=headers, 
        proxies=None, 
        allow_redirects=False, 
    )
    if rh.status_code == 307 and r.status_code == 307:
        # Civitai redirect
        redirect_url = r.content.decode("utf-8")
        if not redirect_url.startswith("http"):
            # Civitai requires login (NSFW or user-required)
            # TODO: inform user WHY download failed
            raise ValueError("Unable to download from Civitai! Redirect url: " + str(redirect_url))
        download_file(redirect_url, filename, overwrite)
        return
    if rh.status_code == 302 and r.status_code == 302:
        # HuggingFace redirect
        redirect_url = r.content.decode("utf-8")
        redirect_url_index = redirect_url.find("http")
        if redirect_url_index == -1:
            raise ValueError("Unable to download from HuggingFace! Redirect url: " + str(redirect_url))
        download_file(redirect_url[redirect_url_index:], filename, overwrite)
        return
    elif rh.status_code == 200 and r.status_code == 206:
        # Civitai download link
        pass

    total_size = int(rh.headers.get("Content-Length", 0)) # TODO: pass in total size earlier

    print("Downloading file: " + url)
    if total_size != 0:
        print("Download file size: " + str(total_size))

    mode = "wb" if overwrite else "ab"
    with open(filename_temp, mode) as f:
        for chunk in r.iter_content(chunk_size=1024):
            if chunk is not None:
                downloaded_size += len(chunk)
                f.write(chunk)
                f.flush()

                if total_size != 0:
                    fraction = 1 if downloaded_size == total_size else downloaded_size / total_size
                    progress = int(50 * fraction)
                    sys.stdout.reconfigure(encoding="utf-8")
                    sys.stdout.write(
                        "\r[%s%s] %d%%"
                        % (
                            "-" * progress,
                            " " * (50 - progress),
                            100 * fraction,
                        )
                    )
                    sys.stdout.flush()
    print()

    if overwrite and os.path.isfile(filename):
        os.remove(filename)
    os.rename(filename_temp, filename)
    print("Saved file: " + filename)


def bytes_to_size(total_bytes):
    units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
    b = total_bytes
    i = 0
    while True:
        b = b >> 10
        if (b == 0): break
        i = i + 1
    if i >= len(units) or i == 0:
        return str(total_bytes) + " " + units[0]
    return "{:.2f}".format(total_bytes / (1 << (i * 10))) + " " + units[i]


@server.PromptServer.instance.routes.get("/model-manager/model/info/{path}")
async def get_model_metadata(request):
    result = { "success": False }

    model_path = request.match_info["path"]
    if model_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)

    abs_path, model_type = search_path_to_system_path(model_path)
    if abs_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)

    data = {}
    comfyui_directory, name = os.path.split(model_path)
    data["File Name"] = name
    data["File Directory"] = comfyui_directory
    data["File Size"] = bytes_to_size(os.path.getsize(abs_path))
    stats = pathlib.Path(abs_path).stat()
    date_format = "%Y-%m-%d %H:%M:%S"
    date_modified = datetime.fromtimestamp(stats.st_mtime).strftime(date_format)
    #data["Date Modified"] = date_modified
    #data["Date Created"] = datetime.fromtimestamp(stats.st_ctime).strftime(date_format)

    model_extensions = folder_paths_get_supported_pt_extensions(model_type)
    abs_name , _ = split_valid_ext(abs_path, model_extensions)

    for extension in preview_extensions:
        maybe_preview = abs_name + extension
        if os.path.isfile(maybe_preview):
            preview_path, _ = split_valid_ext(model_path, model_extensions)
            preview_modified = pathlib.Path(maybe_preview).stat().st_mtime_ns
            data["Preview"] = {
                "path": preview_path + extension,
                "dateModified": str(preview_modified),
            }
            break

    header = get_safetensor_header(abs_path)
    metadata = header.get("__metadata__", None)

    if metadata is not None and data.get("Preview", None) is None:
        thumbnail = metadata.get("modelspec.thumbnail")
        if thumbnail is not None:
            i0 = thumbnail.find("/") + 1
            i1 = thumbnail.find(";", i0)
            thumbnail_extension = "." + thumbnail[i0:i1]
            if thumbnail_extension in image_extensions:
                data["Preview"] = {
                    "path": request.query["path"] + thumbnail_extension,
                    "dateModified": date_modified,
                }

    if metadata is not None:
        data["Base Training Model"] = metadata.get("ss_sd_model_name", "")
        data["Base Model Version"] = metadata.get("ss_base_model_version", "")
        data["Network Dimension"] = metadata.get("ss_network_dim", "")
        data["Network Alpha"] = metadata.get("ss_network_alpha", "")

    if metadata is not None:
        training_comment = metadata.get("ss_training_comment", "")
        data["Description"] = (
            metadata.get("modelspec.description", "") + 
            "\n\n" + 
            metadata.get("modelspec.usage_hint", "") + 
            "\n\n" + 
            training_comment if training_comment != "None" else ""
        ).strip()

    notes_file = abs_name + model_notes_extension
    notes = ""
    if os.path.isfile(notes_file):
        with open(notes_file, 'r', encoding="utf-8") as f:
            notes = f.read()

    web_url_file = abs_name + ".url"
    web_url = ""
    if os.path.isfile(web_url_file):
        web_url = try_load_web_url(web_url_file)

    if metadata is not None:
        img_buckets = metadata.get("ss_bucket_info", None)
        datasets = metadata.get("ss_datasets", None)

        if type(img_buckets) is str:
            img_buckets = json.loads(img_buckets)
        elif type(datasets) is str:
                datasets = json.loads(datasets)
                if isinstance(datasets, list):
                    datasets = datasets[0]
                    img_buckets = datasets.get("bucket_info", None)
        resolutions = {}
        if img_buckets is not None:
            buckets = img_buckets.get("buckets", {})
            for resolution in buckets.values():
                dim = resolution["resolution"]
                x, y = dim[0], dim[1]
                count = resolution["count"]
                resolutions[str(x) + "x" + str(y)] = count
        resolutions = list(resolutions.items())
        resolutions.sort(key=lambda x: x[1], reverse=True)
        data["Bucket Resolutions"] = resolutions

    tags = None
    if metadata is not None:
        dir_tags = metadata.get("ss_tag_frequency", "{}")
        if type(dir_tags) is str:
            dir_tags = json.loads(dir_tags)
        tags = {}
        for train_tags in dir_tags.values():
            for tag, count in train_tags.items():
                tags[tag] = tags.get(tag, 0) + count
        tags = list(tags.items())
        tags.sort(key=lambda x: x[1], reverse=True)

    model_info = ModelInfo.try_load_cached(abs_path)
    web_previews = ModelInfo.get_web_preview_urls(model_info, True)

    result["success"] = True
    result["info"] = data
    if metadata is not None:
        result["metadata"] = metadata
    if tags is not None:
        result["tags"] = tags
    result["notes"] = notes
    result["url"] = web_url
    result["webPreviews"] = web_previews
    return web.json_response(result)


@server.PromptServer.instance.routes.get("/model-manager/model/web-url")
async def get_model_web_url(request):
    result = { "success": False }

    model_path = request.query.get("path", None)
    if model_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)

    abs_path, model_type = search_path_to_system_path(model_path)
    if abs_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)

    url_path = os.path.splitext(abs_path)[0] + ".url"
    if os.path.isfile(url_path):
        web_url = try_load_web_url(url_path)
        if web_url != "":
            result["success"] = True
            return web.json_response({ "url": web_url })

    model_info = ModelInfo.search_info(abs_path)
    if len(model_info) == 0:
        result["alert"] = "Unable to find model info!"
        return web.json_response(result)
    web_url = ModelInfo.get_url(model_info)
    if web_url != "" and web_url is not None:
        save_web_url(url_path, web_url)
        result["success"] = True

    return web.json_response({ "url": web_url })


@server.PromptServer.instance.routes.get("/model-manager/system-separator")
async def get_system_separator(request):
    return web.json_response(os.path.sep)


@server.PromptServer.instance.routes.post("/model-manager/model/download/info")
async def download_model_info(request):
    result = { "success": False }

    model_path = request.query.get("path", None)
    if model_path is None:
        result["alert"] = "Missing model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)

    abs_path, model_type = search_path_to_system_path(model_path)
    if abs_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)

    model_info = ModelInfo.search_info(abs_path, cache=True, use_cached=False)
    if len(model_info) > 0:
        result["success"] = True

    return web.json_response(result)


@server.PromptServer.instance.routes.post("/model-manager/model/download")
async def download_model(request):
    formdata = await request.post()
    result = { "success": False }

    overwrite = formdata.get("overwrite", "false").lower()
    overwrite = True if overwrite == "true" else False

    model_path = formdata.get("path", "/0")
    directory, model_type = search_path_to_system_path(model_path)
    if directory is None:
        result["alert"] = "Invalid save path!"
        return web.json_response(result)

    # download model
    download_uri = formdata.get("download")
    if download_uri is None:
        result["alert"] = "Invalid download url!"
        return web.json_response(result)

    name = formdata.get("name")
    model_extensions = folder_paths_get_supported_pt_extensions(model_type)
    name_head, model_extension = split_valid_ext(name, model_extensions)
    name_without_extension = os.path.split(name_head)[1]
    if name_without_extension == "":
        result["alert"] = "Cannot have empty model name!"
        return web.json_response(result)
    if model_extension == "":
        result["alert"] = "Unrecognized model extension!"
        return web.json_response(result)
    file_name = os.path.join(directory, name)
    try:
        download_file(download_uri, file_name, overwrite)
    except Exception as e:
        print(e, file=sys.stderr, flush=True)
        result["alert"] = "Failed to download model!\n\n" + str(e)
        return web.json_response(result)

    # download model info
    model_info = ModelInfo.search_info(file_name, cache=True) # save json

    # save url
    url_file_path = os.path.splitext(file_name)[0] + ".url"
    url = ModelInfo.get_url(model_info)
    if url != "" and url is not None:
        save_web_url(url_file_path, url)

    # save image as model preview
    image = formdata.get("image")
    if image is not None and image != "":
        try:
            download_model_preview(
                file_name,
                image,
                formdata.get("overwrite"),
            )
        except Exception as e:
            print(e, file=sys.stderr, flush=True)
            result["alert"] = "Failed to download preview!\n\n" + str(e)

    result["success"] = True
    return web.json_response(result)


@server.PromptServer.instance.routes.post("/model-manager/model/move")
async def move_model(request):
    body = await request.json()
    result = { "success": False }

    old_file = body.get("oldFile", None)
    if old_file is None:
        result["alert"] = "No model was given!"
        return web.json_response(result)
    old_file, old_model_type = search_path_to_system_path(old_file)
    if not os.path.isfile(old_file):
        result["alert"] = "Model does not exist!"
        return web.json_response(result)
    old_model_extensions = folder_paths_get_supported_pt_extensions(old_model_type)
    old_file_without_extension, model_extension = split_valid_ext(old_file, old_model_extensions)
    if model_extension == "":
        result["alert"] = "Invalid model extension!"
        return web.json_response(result)

    new_file = body.get("newFile", None)
    if new_file is None or new_file == "":
        result["alert"] = "New model name was invalid!"
        return web.json_response(result)
    new_file, new_model_type = search_path_to_system_path(new_file)
    if not new_file.endswith(model_extension):
        result["alert"] = "Cannot change model extension!"
        return web.json_response(result)
    if os.path.isfile(new_file):
        result["alert"] = "Cannot overwrite existing model!"
        return web.json_response(result)
    new_model_extensions = folder_paths_get_supported_pt_extensions(new_model_type)
    new_file_without_extension, new_model_extension = split_valid_ext(new_file, new_model_extensions)
    if model_extension != new_model_extension:
        result["alert"] = "Cannot change model extension!"
        return web.json_response(result)
    new_file_dir, new_file_name = os.path.split(new_file)
    if not os.path.isdir(new_file_dir):
        result["alert"] = "Destination directory does not exist!"
        return web.json_response(result)
    new_name_without_extension = os.path.splitext(new_file_name)[0]
    if new_file_name == new_name_without_extension or new_name_without_extension == "":
        result["alert"] = "New model name was empty!"
        return web.json_response(result)

    if old_file == new_file:
        # no-op
        result["success"] = True
        return web.json_response(result)
    try:
        shutil.move(old_file, new_file)
        print("Moved file: " + new_file)
    except ValueError as e:
        print(e, file=sys.stderr, flush=True)
        result["alert"] = "Failed to move model!\n\n" + str(e)
        return web.json_response(result)

    # TODO: this could overwrite existing files in destination; do a check beforehand?
    for extension in preview_extensions + (model_notes_extension,) + (model_info_extension,):
        old_file = old_file_without_extension + extension
        if os.path.isfile(old_file):
            new_file = new_file_without_extension + extension
            try:
                shutil.move(old_file, new_file)
                print("Moved file: " + new_file)
            except ValueError as e:
                print(e, file=sys.stderr, flush=True)
                msg = result.get("alert","")
                if msg == "":
                    result["alert"] = "Failed to move model resource file!\n\n" + str(e)
                else:
                    result["alert"] = msg + "\n" + str(e)

    result["success"] = True
    return web.json_response(result)


def delete_same_name_files(path_without_extension, extensions, keep_extension=None):
    for extension in extensions:
        if extension == keep_extension: continue
        file = path_without_extension + extension
        if os.path.isfile(file):
            os.remove(file)
            print("Deleted file: " + file)


@server.PromptServer.instance.routes.post("/model-manager/model/delete")
async def delete_model(request):
    result = { "success": False }

    model_path = request.query.get("path", None)
    if model_path is None:
        result["alert"] = "Missing model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)
    model_path, model_type = search_path_to_system_path(model_path)
    if model_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)

    model_extensions = folder_paths_get_supported_pt_extensions(model_type)
    path_and_name, model_extension = split_valid_ext(model_path, model_extensions)
    if model_extension == "":
        result["alert"] = "Cannot delete file!"
        return web.json_response(result)

    if os.path.isfile(model_path):
        os.remove(model_path)
        result["success"] = True
        print("Deleted file: " + model_path)

        delete_same_name_files(path_and_name, preview_extensions)
        delete_same_name_files(path_and_name, (model_notes_extension,))
        delete_same_name_files(path_and_name, (model_info_extension,))

    return web.json_response(result)


@server.PromptServer.instance.routes.post("/model-manager/notes/save")
async def set_notes(request):
    body = await request.json()
    result = { "success": False }

    dt_epoch = body.get("timestamp", None)

    text = body.get("notes", None)
    if type(text) is not str:
        result["alert"] = "Invalid note!"
        return web.json_response(result)

    model_path = body.get("path", None)
    if type(model_path) is not str:
        result["alert"] = "Missing model path!"
        return web.json_response(result)
    model_path, model_type = search_path_to_system_path(model_path)
    model_extensions = folder_paths_get_supported_pt_extensions(model_type)
    file_path_without_extension, _ = split_valid_ext(model_path, model_extensions)
    filename = os.path.normpath(file_path_without_extension + model_notes_extension)
    
    if dt_epoch is not None and os.path.exists(filename) and os.path.getmtime(filename) > dt_epoch:
        # discard late save
        result["success"] = True
        return web.json_response(result)
    
    if text.isspace() or text == "":
        if os.path.exists(filename):
            os.remove(filename)
            #print("Deleted file: " + filename)  # autosave -> too verbose
    else:
        try:
            with open(filename, "w", encoding="utf-8") as f:
                f.write(text)
            if dt_epoch is not None:
                os.utime(filename, (dt_epoch, dt_epoch))
            #print("Saved file: " + filename)  # autosave -> too verbose
        except ValueError as e:
            print(e, file=sys.stderr, flush=True)
            result["alert"] = "Failed to save notes!\n\n" + str(e)
            return web.json_response(result)

    result["success"] = True
    return web.json_response(result)


@server.PromptServer.instance.routes.post("/model-manager/notes/download")
async def try_download_notes(request):
    result = { "success": False }

    model_path = request.query.get("path", None)
    if model_path is None:
        result["alert"] = "Missing model path!"
        return web.json_response(result)
    model_path = urllib.parse.unquote(model_path)

    abs_path, model_type = search_path_to_system_path(model_path)
    if abs_path is None:
        result["alert"] = "Invalid model path!"
        return web.json_response(result)

    overwrite = request.query.get("overwrite", None)
    overwrite = not (overwrite == "False" or overwrite == "false" or overwrite == None)
    notes_path = os.path.splitext(abs_path)[0] + ".txt"
    if not overwrite and os.path.isfile(notes_path):
        result["alert"] = "Notes already exist!"
        return web.json_response(result)

    notes = ModelInfo.search_notes(abs_path)
    if notes.isspace() or notes == "":
        result["alert"] = "No notes found!"
        return web.json_response(result)

    try:
        with open(notes_path, "w", encoding="utf-8") as f:
            f.write(notes)
        result["success"] = True
    except ValueError as e:
        print(e, file=sys.stderr, flush=True)
        result["alert"] = "Failed to save notes!\n\n" + str(e)
        return web.json_response(result)

    result["notes"] = notes
    return web.json_response(result)


WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}
__all__ = ["NODE_CLASS_MAPPINGS"]
