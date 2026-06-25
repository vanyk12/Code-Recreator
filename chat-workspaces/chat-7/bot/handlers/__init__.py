
from .start import router as start_router
from .folders import router as folders_router
from .notes import router as notes_router
from .tasks import router as tasks_router
from .reminders import router as reminders_router

routers = [start_router, folders_router, notes_router, tasks_router, reminders_router]
