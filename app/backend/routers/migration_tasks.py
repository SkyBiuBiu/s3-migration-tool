import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.migration_tasks import Migration_tasksService
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/migration_tasks", tags=["migration_tasks"])


# ---------- Pydantic Schemas ----------
class Migration_tasksData(BaseModel):
    """Entity data schema (for create/update)"""
    name: str
    source_id: int
    target_id: int
    source_prefix: str = None
    target_prefix: str = None
    skip_existing: bool = None
    sync_mode: str = None
    verify: bool = None
    concurrency: int = None
    bandwidth_mbps: float = None
    include_suffixes: str = None
    exclude_suffixes: str = None
    min_size: float = None
    max_size: float = None
    modified_after: str = None
    modified_before: str = None
    status: str
    continuation_token: str = None
    prefix_queue: str = None
    listing_done: bool = None
    pending_keys: str = None
    total_count: int = None
    total_bytes: float = None
    done_count: int = None
    skipped_count: int = None
    failed_count: int = None
    verified_count: int = None
    bytes_transferred: int = None
    bytes_copied: float = None
    processed_bytes: float = None
    failed_items: str = None
    logs: str = None
    error_message: str = None
    locked_until: float = None
    last_run_at: float = None


class Migration_tasksUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    name: Optional[str] = None
    source_id: Optional[int] = None
    target_id: Optional[int] = None
    source_prefix: Optional[str] = None
    target_prefix: Optional[str] = None
    skip_existing: Optional[bool] = None
    sync_mode: Optional[str] = None
    verify: Optional[bool] = None
    concurrency: Optional[int] = None
    bandwidth_mbps: Optional[float] = None
    include_suffixes: Optional[str] = None
    exclude_suffixes: Optional[str] = None
    min_size: Optional[float] = None
    max_size: Optional[float] = None
    modified_after: Optional[str] = None
    modified_before: Optional[str] = None
    status: Optional[str] = None
    continuation_token: Optional[str] = None
    prefix_queue: Optional[str] = None
    listing_done: Optional[bool] = None
    pending_keys: Optional[str] = None
    total_count: Optional[int] = None
    total_bytes: Optional[float] = None
    done_count: Optional[int] = None
    skipped_count: Optional[int] = None
    failed_count: Optional[int] = None
    verified_count: Optional[int] = None
    bytes_transferred: Optional[int] = None
    bytes_copied: Optional[float] = None
    processed_bytes: Optional[float] = None
    failed_items: Optional[str] = None
    logs: Optional[str] = None
    error_message: Optional[str] = None
    locked_until: Optional[float] = None
    last_run_at: Optional[float] = None


class Migration_tasksResponse(BaseModel):
    """Entity response schema"""
    id: int
    user_id: str
    name: str
    source_id: int
    target_id: int
    source_prefix: Optional[str] = None
    target_prefix: Optional[str] = None
    skip_existing: Optional[bool] = None
    sync_mode: Optional[str] = None
    verify: Optional[bool] = None
    concurrency: Optional[int] = None
    bandwidth_mbps: Optional[float] = None
    include_suffixes: Optional[str] = None
    exclude_suffixes: Optional[str] = None
    min_size: Optional[float] = None
    max_size: Optional[float] = None
    modified_after: Optional[str] = None
    modified_before: Optional[str] = None
    status: str
    continuation_token: Optional[str] = None
    prefix_queue: Optional[str] = None
    listing_done: Optional[bool] = None
    pending_keys: Optional[str] = None
    total_count: Optional[int] = None
    total_bytes: Optional[float] = None
    done_count: Optional[int] = None
    skipped_count: Optional[int] = None
    failed_count: Optional[int] = None
    verified_count: Optional[int] = None
    bytes_transferred: Optional[int] = None
    bytes_copied: Optional[float] = None
    processed_bytes: Optional[float] = None
    failed_items: Optional[str] = None
    logs: Optional[str] = None
    error_message: Optional[str] = None
    locked_until: Optional[float] = None
    last_run_at: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Migration_tasksListResponse(BaseModel):
    """List response schema"""
    items: List[Migration_tasksResponse]
    total: int
    skip: int
    limit: int


class Migration_tasksBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Migration_tasksData]


class Migration_tasksBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Migration_tasksUpdateData


class Migration_tasksBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Migration_tasksBatchUpdateItem]


class Migration_tasksBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Migration_tasksListResponse)
async def query_migration_taskss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Query migration_taskss with filtering, sorting, and pagination (user can only see their own records)"""
    logger.debug(f"Querying migration_taskss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Migration_tasksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
            user_id=str(current_user.id),
        )
        logger.debug(f"Found {result['total']} migration_taskss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid migration_tasks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying migration_taskss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Migration_tasksListResponse)
async def query_migration_taskss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query migration_taskss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying migration_taskss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Migration_tasksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} migration_taskss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid migration_tasks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying migration_taskss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Migration_tasksResponse)
async def get_migration_tasks(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single migration_tasks by ID (user can only see their own records)"""
    logger.debug(f"Fetching migration_tasks with id: {id}, fields={fields}")
    
    service = Migration_tasksService(db)
    try:
        result = await service.get_by_id(id, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Migration_tasks with id {id} not found")
            raise HTTPException(status_code=404, detail="Migration_tasks not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching migration_tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Migration_tasksResponse, status_code=201)
async def create_migration_tasks(
    data: Migration_tasksData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new migration_tasks"""
    logger.debug(f"Creating new migration_tasks with data: {data}")
    
    service = Migration_tasksService(db)
    try:
        result = await service.create(data.model_dump(), user_id=str(current_user.id))
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create migration_tasks")
        
        logger.info(f"Migration_tasks created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating migration_tasks: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating migration_tasks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Migration_tasksResponse], status_code=201)
async def create_migration_taskss_batch(
    request: Migration_tasksBatchCreateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple migration_taskss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} migration_taskss")
    
    service = Migration_tasksService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump(), user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} migration_taskss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Migration_tasksResponse])
async def update_migration_taskss_batch(
    request: Migration_tasksBatchUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update multiple migration_taskss in a single request (requires ownership)"""
    logger.debug(f"Batch updating {len(request.items)} migration_taskss")
    
    service = Migration_tasksService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict, user_id=str(current_user.id))
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} migration_taskss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Migration_tasksResponse)
async def update_migration_tasks(
    id: int,
    data: Migration_tasksUpdateData,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing migration_tasks (requires ownership)"""
    logger.debug(f"Updating migration_tasks {id} with data: {data}")

    service = Migration_tasksService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict, user_id=str(current_user.id))
        if not result:
            logger.warning(f"Migration_tasks with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Migration_tasks not found")
        
        logger.info(f"Migration_tasks {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating migration_tasks {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating migration_tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_migration_taskss_batch(
    request: Migration_tasksBatchDeleteRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple migration_taskss by their IDs (requires ownership)"""
    logger.debug(f"Batch deleting {len(request.ids)} migration_taskss")
    
    service = Migration_tasksService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id, user_id=str(current_user.id))
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} migration_taskss successfully")
        return {"message": f"Successfully deleted {deleted_count} migration_taskss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_migration_tasks(
    id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single migration_tasks by ID (requires ownership)"""
    logger.debug(f"Deleting migration_tasks with id: {id}")
    
    service = Migration_tasksService(db)
    try:
        success = await service.delete(id, user_id=str(current_user.id))
        if not success:
            logger.warning(f"Migration_tasks with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Migration_tasks not found")
        
        logger.info(f"Migration_tasks {id} deleted successfully")
        return {"message": "Migration_tasks deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting migration_tasks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")