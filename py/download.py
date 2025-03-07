import sys
import os
import uuid
import time
import requests
import folder_paths


from typing import Callable, Awaitable, Any, Literal, Union, Optional
from dataclasses import dataclass
from aiohttp import web


from . import config
from . import utils
from . import thread

comfyui_manager_glob_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..", "ComfyUI-Manager/glob"))
sys.path.append(comfyui_manager_glob_path)

@dataclass
class TaskStatus:
    taskId: str
    type: str
    fullname: str
    preview: str
    status: Literal["pause", "waiting", "doing"] = "pause"
    platform: Union[str, None] = None
    downloadedSize: float = 0
    totalSize: float = 0
    progress: float = 0
    bps: float = 0
    error: Optional[str] = None

    def __init__(self, **kwargs):
        self.taskId = kwargs.get("taskId", None)
        self.type = kwargs.get("type", None)
        self.fullname = kwargs.get("fullname", None)
        self.preview = kwargs.get("preview", None)
        self.status = kwargs.get("status", "pause")
        self.platform = kwargs.get("platform", None)
        self.downloadedSize = kwargs.get("downloadedSize", 0)
        self.totalSize = kwargs.get("totalSize", 0)
        self.progress = kwargs.get("progress", 0)
        self.bps = kwargs.get("bps", 0)
        self.error = kwargs.get("error", None)

    def to_dict(self):
        return {
            "taskId": self.taskId,
            "type": self.type,
            "fullname": self.fullname,
            "preview": self.preview,
            "status": self.status,
            "platform": self.platform,
            "downloadedSize": self.downloadedSize,
            "totalSize": self.totalSize,
            "progress": self.progress,
            "bps": self.bps,
            "error": self.error,
        }


@dataclass
class TaskContent:
    titlename: str
    baseModel: str
    type: str
    pathIndex: int
    fullname: str
    modelPage: str
    description_former: str
    description: str
    downloadPlatform: str
    downloadUrl: str
    sizeBytes: float
    hashes: Optional[dict[str, str]] = None

    def __init__(self, **kwargs):
        self.titlename = kwargs.get("titlename", None)
        self.baseModel = kwargs.get("baseModel", None)
        self.type = kwargs.get("type", None)
        self.pathIndex = int(kwargs.get("pathIndex", 0))
        self.fullname = kwargs.get("fullname", None)
        self.modelPage = kwargs.get("modelPage", None)
        self.description_former = kwargs.get("description_former", None)
        self.description = kwargs.get("description", None)
        self.downloadPlatform = kwargs.get("downloadPlatform", None)
        self.downloadUrl = kwargs.get("downloadUrl", None)
        self.sizeBytes = float(kwargs.get("sizeBytes", 0))
        self.hashes = kwargs.get("hashes", None)

    def to_dict(self):
        return {
            "titlename": self.titlename,
            "baseModel": self.baseModel,
            "type": self.type,
            "pathIndex": self.pathIndex,
            "fullname": self.fullname,
            "modelPage": self.modelPage,
            "description_former": self.description_former,
            "description": self.description,
            "downloadPlatform": self.downloadPlatform,
            "downloadUrl": self.downloadUrl,
            "sizeBytes": self.sizeBytes,
            "hashes": self.hashes,
        }


class ModelDownload:
    def add_routes(self, routes):

        @routes.get("/model-manager/download/task")
        async def scan_download_tasks(request):
            """
            Read download task list.
            """
            try:
                result = await self.scan_model_download_task_list()
                return web.json_response({"success": True, "data": result})
            except Exception as e:
                error_msg = f"Read download task list failed: {e}"
                utils.print_error(error_msg)
                return web.json_response({"success": False, "error": error_msg})

        @routes.put("/model-manager/download/{task_id}")
        async def resume_download_task(request):
            """
            Toggle download task status.
            """
            try:
                task_id = request.match_info.get("task_id", None)
                if task_id is None:
                    raise web.HTTPBadRequest(reason="Invalid task id")
                json_data = await request.json()
                status = json_data.get("status", None)
                if status == "pause":
                    await self.pause_model_download_task(task_id)
                elif status == "resume":
                    await self.download_model(task_id, request)
                else:
                    raise web.HTTPBadRequest(reason="Invalid status")

                return web.json_response({"success": True})
            except Exception as e:
                error_msg = f"Resume download task failed: {str(e)}"
                utils.print_error(error_msg)
                return web.json_response({"success": False, "error": error_msg})

        @routes.delete("/model-manager/download/{task_id}")
        async def delete_model_download_task(request):
            """
            Delete download task.
            """
            task_id = request.match_info.get("task_id", None)
            try:
                await self.delete_model_download_task(task_id)
                return web.json_response({"success": True})
            except Exception as e:
                error_msg = f"Delete download task failed: {str(e)}"
                utils.print_error(error_msg)
                return web.json_response({"success": False, "error": error_msg})

        @routes.post("/model-manager/model")
        async def create_model(request):
            """
            Create a new model.

            request body: x-www-form-urlencoded
            - titlename: model title.
            - baseModel: base model.
            - type: model type.
            - pathIndex: index of the model folders.
            - fullname: filename that relative to the model folder.
            - previewFile: preview file.
            - modelPage: model page.
            - description_former: former description.
            - description: description.
            - downloadPlatform: download platform.
            - downloadUrl: download url.
            - hash: a JSON string containing the hash value of the downloaded model.
            """
            task_data = await request.post()
            task_data = dict(task_data)
            try:
                task_id = await self.create_model_download_task(task_data, request)
                return web.json_response({"success": True, "data": {"taskId": task_id}})
            except Exception as e:
                error_msg = f"Create model download task failed: {str(e)}"
                utils.print_error(error_msg)
                return web.json_response({"success": False, "error": error_msg})

    download_model_task_status: dict[str, TaskStatus] = {}

    download_thread_pool = thread.DownloadThreadPool()

    def set_task_content(self, task_id: str, task_content: Union[TaskContent, dict]):
        download_path = utils.get_download_path()
        task_file_path = utils.join_path(download_path, f"{task_id}.task")
        utils.save_dict_pickle_file(task_file_path, task_content)

    def get_task_content(self, task_id: str):
        download_path = utils.get_download_path()
        task_file = utils.join_path(download_path, f"{task_id}.task")
        if not os.path.isfile(task_file):
            raise RuntimeError(f"Task {task_id} not found")
        task_content = utils.load_dict_pickle_file(task_file)
        if isinstance(task_content, TaskContent):
            return task_content
        return TaskContent(**task_content)

    def get_task_status(self, task_id: str):
        task_status = self.download_model_task_status.get(task_id, None)

        if task_status is None:
            download_path = utils.get_download_path()
            task_content = self.get_task_content(task_id)
            download_file = utils.join_path(download_path, f"{task_id}.download")
            download_size = 0
            if os.path.exists(download_file):
                download_size = os.path.getsize(download_file)

            total_size = task_content.sizeBytes
            task_status = TaskStatus(
                taskId=task_id,
                type=task_content.type,
                fullname=task_content.fullname,
                preview=utils.get_model_preview_name(download_file),
                platform=task_content.downloadPlatform,
                downloadedSize=download_size,
                totalSize=task_content.sizeBytes,
                progress=download_size / total_size * 100 if total_size > 0 else 0,
            )

            self.download_model_task_status[task_id] = task_status

        return task_status

    def delete_task_status(self, task_id: str):
        self.download_model_task_status.pop(task_id, None)

    async def scan_model_download_task_list(self):
        """
        Scan the download directory and send the task list to the client.
        """
        download_dir = utils.get_download_path()
        task_files = utils.search_files(download_dir)
        task_files = folder_paths.filter_files_extensions(task_files, [".task"])
        task_files = sorted(
            task_files,
            key=lambda x: os.stat(utils.join_path(download_dir, x)).st_ctime,
            reverse=True,
        )
        task_list: list[dict] = []
        for task_file in task_files:
            task_id = task_file.replace(".task", "")
            task_status = self.get_task_status(task_id)
            task_list.append(task_status.to_dict())

        return task_list

    async def create_model_download_task(self, task_data: dict, request):
        """
        Creates a download task for the given data.
        """
        model_type = task_data.get("type", None)
        path_index = int(task_data.get("pathIndex", None))
        fullname = task_data.get("fullname", None)
        baseModel = task_data.get("baseModel", None)

        model_path = utils.get_full_path(model_type, path_index, fullname, baseModel)
        # Check if the model path is valid
        #if os.path.exists(model_path):
        #    raise RuntimeError(f"File already exists: {model_path}")

        download_path = utils.get_download_path()

        task_id = uuid.uuid4().hex
        task_path = utils.join_path(download_path, f"{task_id}.task")
        if os.path.exists(task_path):
            raise RuntimeError(f"Task {task_id} already exists")
        download_platform = task_data.get("downloadPlatform", None)

        try:
            preview_file = task_data.pop("previewFile", None)
            utils.save_model_preview_image(task_path, preview_file, download_platform)
            self.set_task_content(task_id, task_data)
            task_status = TaskStatus(
                taskId=task_id,
                type=model_type,
                fullname=fullname,
                preview=utils.get_model_preview_name(task_path),
                platform=download_platform,
                totalSize=float(task_data.get("sizeBytes", 0)),
            )
            self.download_model_task_status[task_id] = task_status
            await utils.send_json("create_download_task", task_status.to_dict())
        except Exception as e:
            await self.delete_model_download_task(task_id)
            raise RuntimeError(str(e)) from e

        await self.download_model(task_id, request)
        return task_id

    async def pause_model_download_task(self, task_id: str):
        task_status = self.get_task_status(task_id=task_id)
        task_status.status = "pause"

    async def delete_model_download_task(self, task_id: str):
        task_status = self.get_task_status(task_id)
        is_running = task_status.status == "doing"
        task_status.status = "waiting"
        await utils.send_json("delete_download_task", task_id)

        # Pause the task
        if is_running:
            task_status.status = "pause"
            time.sleep(1)

        download_dir = utils.get_download_path()
        task_file_list = os.listdir(download_dir)
        for task_file in task_file_list:
            task_file_target = os.path.splitext(task_file)[0]
            if task_file_target == task_id:
                self.delete_task_status(task_id)
                os.remove(utils.join_path(download_dir, task_file))

        await utils.send_json("delete_download_task", task_id)

    async def download_model(self, task_id: str, request):
        async def download_task(task_id: str):
            async def report_progress(task_status: TaskStatus):
                await utils.send_json("update_download_task", task_status.to_dict())

            try:
                # When starting a task from the queue, the task may not exist
                task_status = self.get_task_status(task_id)
            except:
                return

            # Update task status
            task_status.status = "doing"
            await utils.send_json("update_download_task", task_status.to_dict())

            try:

                # Set download request headers
                headers = {"User-Agent": config.user_agent}

                download_platform = task_status.platform
                if download_platform == "civitai":
                    api_key = utils.get_setting_value(request, "api_key.civitai")
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"

                elif download_platform == "huggingface":
                    api_key = utils.get_setting_value(request, "api_key.huggingface")
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"

                progress_interval = 1.0
                await self.download_model_file(
                    task_id=task_id,
                    headers=headers,
                    progress_callback=report_progress,
                    interval=progress_interval,
                )
            except Exception as e:
                task_status.status = "pause"
                task_status.error = str(e)
                await utils.send_json("update_download_task", task_status.to_dict())
                task_status.error = None
                utils.print_error(str(e))

        try:
            status = self.download_thread_pool.submit(download_task, task_id)
            if status == "Waiting":
                task_status = self.get_task_status(task_id)
                task_status.status = "waiting"
                await utils.send_json("update_download_task", task_status.to_dict())
        except Exception as e:
            task_status.status = "pause"
            task_status.error = str(e)
            await utils.send_json("update_download_task", task_status.to_dict())
            task_status.error = None
            utils.print_error(str(e))

    async def download_model_file(
        self,
        task_id: str,
        headers: dict,
        progress_callback: Callable[[TaskStatus], Awaitable[Any]],
        interval: float = 1.0,
    ):
        from manager_downloader import download_url

        async def download_complete():
            """
            Restore the model information from the task file
            and move the model file to the target directory.
            """
            from manager_core import json_merge, manager_util
            import json
            import copy
            from pathlib import Path

            # Write description file
            description = task_content.description
            name = os.path.splitext(task_content.fullname)[0]
            description_file = utils.join_path(model_dir, f"{name}.md")
            with open(description_file, "w", encoding="utf-8", newline="") as f:
                f.write(description)

            # get preview
            download_tmp_file = utils.join_path(download_path, f"{task_id}.download")
            utils.move_preview(download_tmp_file, model_path)

            # append model list
            if 'CUSTOMNODEDB_PATH' in os.environ:
                custom_node_db_paths = os.environ['CUSTOMNODEDB_PATH'].split(';')
                # 获取custom_node_db_paths中包含civitai-list的那个
                civitai_node_db_path = [path for path in custom_node_db_paths if 'civitai-list' in path][0]
                civitai_model_list_path = os.path.normpath(os.path.join(civitai_node_db_path, "model-list.json"))
                civitai_model_list = {}
                if os.path.exists(civitai_model_list_path):
                    civitai_model_list = await manager_util.get_data(civitai_model_list_path)
                json_obj_merge = copy.deepcopy(civitai_model_list)
                total_size = task_content.sizeBytes
                # 转换total_size的Bytes为MB,GB这种的字符串
                total_size = utils.convert_bytes(total_size)
                titlename = task_content.titlename
                modelPage = task_content.modelPage
                description_former = task_content.description_former
                comfy_path = os.path.dirname(folder_paths.__file__)
                save_path = model_dir[len(comfy_path):]
                save_path = str(Path(save_path).as_posix()).lower()
                if save_path.startswith("/"):
                    save_path = save_path[1:]
                if save_path.startswith("models/"):
                    save_path = save_path[7:]

                json_append = {
                    "models": [
                        {
                            "name": titlename,
                            "type": model_type,
                            "base": baseModel,
                            "save_path": save_path,
                            "description": description_former,
                            "reference": modelPage,
                            "filename": fullname,
                            "url": model_url,
                            "size": total_size
                        }
                    ]
                }

                json_obj = json_merge(json_obj_merge, json_append)

                if not os.path.exists(civitai_node_db_path):
                    os.makedirs(civitai_node_db_path)
                #json写入civitai_model_list_path中
                with open(civitai_model_list_path, 'w', encoding='utf-8') as file:
                    json.dump(json_obj, file, ensure_ascii=False, indent=4)

            time.sleep(1)
            task_file = utils.join_path(download_path, f"{task_id}.task")
            os.remove(task_file)
            await utils.send_json("complete_download_task", task_id)

        task_status = self.get_task_status(task_id)
        task_content = self.get_task_content(task_id)

        # Check download uri
        model_url = task_content.downloadUrl
        if not model_url:
            raise RuntimeError("No downloadUrl found")

        download_path = utils.get_download_path()

        model_type = task_content.type
        path_index = task_content.pathIndex
        fullname = task_content.fullname
        baseModel = task_content.baseModel
        model_path = os.path.normpath(utils.get_full_path(model_type, path_index, fullname, baseModel))
        model_dir = os.path.dirname(model_path)

        download_info = download_url(model_url, model_dir, fullname)

        #如果file_local == model_path并且文件存在
        if download_info == model_path and os.path.exists(model_path):
            print(f"Download complete")
            await download_complete()
        else:
            task_status.status = "pause"
            await utils.send_json("update_download_task", task_status.to_dict())
