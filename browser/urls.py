from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/tree/', views.repository_tree, name='repository_tree'),
    path('api/tree/stats/', views.repository_tree_stats, name='repository_tree_stats'),
    path('api/database/', views.open_database, name='open_database'),
    path('api/table/', views.table_rows, name='table_rows'),
    path('api/query/', views.run_query, name='run_query'),
    path('api/settings/', views.settings_view, name='settings_view'),
    path('api/settings/test/', views.settings_test_view, name='settings_test_view'),
    path('api/chat/', views.chat_view, name='chat_view'),
]